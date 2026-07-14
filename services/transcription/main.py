import base64
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel
from yt_dlp import YoutubeDL

app = FastAPI(title="StudyForge Local Transcription")

model = WhisperModel("base", device="cpu", compute_type="int8")
MAX_YOUTUBE_FRAMES = 24
MAX_FRAME_WIDTH = 1280


def find_ffmpeg() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def ensure_ffmpeg() -> str:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise HTTPException(
            status_code=503,
            detail="FFmpeg is required for local transcription. Install FFmpeg or run pip install -r services/transcription/requirements.txt.",
        )
    return ffmpeg


def convert_to_audio(ffmpeg: str, source: Path, target: Path) -> None:
    command = [
        ffmpeg,
        "-y",
        "-i",
        str(source),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(target),
    ]
    try:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="ignore").strip() or "FFmpeg could not read this media file."
        raise HTTPException(status_code=422, detail=detail[:800]) from exc


def parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def run_ffmpeg(command: list[str], error_message: str) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="ignore").strip() or error_message
        raise HTTPException(status_code=422, detail=detail[:800]) from exc


def ffprobe_duration(source: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 0.0
    try:
        result = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(source),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        return float(result.stdout.strip() or "0")
    except Exception:
        return 0.0


def download_youtube(url: str, target_dir: Path, need_frames: bool) -> tuple[Path, dict]:
    output = str(target_dir / "youtube.%(ext)s")
    ydl_opts = {
        "format": "best[height<=720]/best" if need_frames else "bestaudio/best",
        "outtmpl": output,
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"yt-dlp could not process this YouTube URL: {exc}") from exc

    candidates = sorted(target_dir.glob("youtube.*"), key=lambda path: path.stat().st_size if path.exists() else 0, reverse=True)
    if not candidates:
        raise HTTPException(status_code=422, detail="yt-dlp did not produce a media file.")
    return candidates[0], info


def data_url_for_frame(path: Path) -> str:
    return f"data:image/jpeg;base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def sample_frames(ffmpeg: str, source: Path, max_frames: int = MAX_YOUTUBE_FRAMES) -> list[dict]:
    frame_dir = source.parent / "frames"
    frame_dir.mkdir(exist_ok=True)
    scene_pattern = frame_dir / "scene_%04d.jpg"
    scene_filter = f"select='gt(scene,0.32)',showinfo,scale={MAX_FRAME_WIDTH}:-2:force_original_aspect_ratio=decrease"
    command = [
        ffmpeg,
        "-y",
        "-i",
        str(source),
        "-vf",
        scene_filter,
        "-vsync",
        "vfr",
        "-frames:v",
        str(max_frames),
        str(scene_pattern),
    ]
    result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    scene_files = sorted(frame_dir.glob("scene_*.jpg"))
    timestamps = [float(match.group(1)) for match in re.finditer(r"pts_time:([0-9.]+)", result.stderr.decode("utf-8", errors="ignore"))]

    if not scene_files:
        duration = ffprobe_duration(source)
        interval = max(12.0, duration / max(1, max_frames)) if duration else 20.0
        interval_pattern = frame_dir / "interval_%04d.jpg"
        interval_filter = f"fps=1/{interval},scale={MAX_FRAME_WIDTH}:-2:force_original_aspect_ratio=decrease"
        run_ffmpeg(
            [
                ffmpeg,
                "-y",
                "-i",
                str(source),
                "-vf",
                interval_filter,
                "-frames:v",
                str(max_frames),
                str(interval_pattern),
            ],
            "FFmpeg could not sample frames from this video.",
        )
        scene_files = sorted(frame_dir.glob("interval_*.jpg"))
        timestamps = [index * interval for index in range(len(scene_files))]

    frames = []
    for index, frame in enumerate(scene_files[:max_frames]):
      timestamp = timestamps[index] if index < len(timestamps) else float(index * 20)
      frames.append(
          {
              "timestamp": timestamp,
              "contentType": "image/jpeg",
              "dataUrl": data_url_for_frame(frame),
          },
      )
    return frames


def transcribe_audio(audio_path: str, language: str = "auto") -> dict:
    segments, info = model.transcribe(
        audio_path,
        language=None if language == "auto" else language,
        vad_filter=True,
        beam_size=5,
    )

    output_segments = []
    full_text = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        output_segments.append(
            {
                "start": segment.start,
                "end": segment.end,
                "text": text,
            },
        )
        full_text.append(text)

    return {
        "language": info.language,
        "segments": output_segments,
        "fullText": " ".join(full_text),
    }


@app.get("/health")
def health() -> dict:
    ffmpeg = find_ffmpeg()
    return {"ok": True, "ffmpeg": bool(ffmpeg), "ffmpegPath": ffmpeg or ""}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: Literal["auto", "en", "ms", "id", "zh"] = Form("auto"),
) -> dict:
    ffmpeg = ensure_ffmpeg()
    if not file.content_type or not (file.content_type.startswith("audio/") or file.content_type.startswith("video/")):
        raise HTTPException(status_code=422, detail="Upload an audio or video file.")

    suffix = Path(file.filename or "upload").suffix or ".media"
    with tempfile.TemporaryDirectory(prefix="studyforge-transcribe-") as temp_dir:
        source = Path(temp_dir) / f"source{suffix}"
        audio = Path(temp_dir) / "audio.wav"
        source.write_bytes(await file.read())
        convert_to_audio(ffmpeg, source, audio)
        result = transcribe_audio(str(audio), language)

    if not result["fullText"]:
        raise HTTPException(status_code=422, detail="No speech was detected in this upload.")
    return result


@app.post("/youtube")
async def youtube(
    url: str = Form(...),
    language: Literal["auto", "en", "ms", "id", "zh"] = Form("auto"),
    transcribe: str = Form("true"),
    frames: str = Form("true"),
) -> dict:
    ffmpeg = ensure_ffmpeg()
    should_transcribe = parse_bool(transcribe)
    should_sample_frames = parse_bool(frames)
    if not url.startswith(("https://www.youtube.com/", "https://youtu.be/", "http://www.youtube.com/", "http://youtu.be/")):
        raise HTTPException(status_code=422, detail="Paste a valid YouTube URL.")

    with tempfile.TemporaryDirectory(prefix="studyforge-youtube-") as temp_dir:
        root = Path(temp_dir)
        source, info = download_youtube(url, root, should_sample_frames)
        result = {
            "title": info.get("title") or "",
            "language": language,
            "segments": [],
            "fullText": "",
            "frames": [],
        }

        if should_transcribe:
            audio = root / "audio.wav"
            convert_to_audio(ffmpeg, source, audio)
            transcription = transcribe_audio(str(audio), language)
            result["language"] = transcription["language"]
            result["segments"] = transcription["segments"]
            result["fullText"] = transcription["fullText"]

        if should_sample_frames:
            result["frames"] = sample_frames(ffmpeg, source)

    if should_transcribe and not result["fullText"]:
        raise HTTPException(status_code=422, detail="No speech was detected in this YouTube video.")
    return result

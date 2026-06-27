#!/bin/bash
# ============================================================================
# compress-media.sh — Сжатие медиа для расшифровки
# Голос: 8kbps opus mono (качество рации)
# Видео: 240p, 5 fps, 50kbps видео
# Фото: ресайз до 512px по большей стороне
# ============================================================================
set -euo pipefail

INPUT_DIR="${1:-/home/me/opencode-tg/exports/media}"
OUTPUT_DIR="${2:-/home/me/opencode-tg/exports/media-compressed}"

echo "=== Compressing media ==="
echo "Source: $INPUT_DIR"
echo "Target: $OUTPUT_DIR"
echo ""

compress_voice() {
    local src="$1" dst="$2"
    ffmpeg -y -i "$src" \
        -ac 1 -ar 8000 -b:a 8k -c:a libopus \
        -application voip -frame_duration 60 \
        -vbr off -compression_level 10 \
        "$dst" 2>/dev/null
}

compress_video_note() {
    local src="$1" dst="$2"
    # Video notes are already small circles, but reduce further
    ffmpeg -y -i "$src" \
        -vf "scale=240:240:force_original_aspect_ratio=decrease,fps=5" \
        -b:v 50k -c:v libx264 -preset ultrafast -crf 40 \
        -an \
        "$dst" 2>/dev/null
}

compress_photo() {
    local src="$1" dst="$2"
    ffmpeg -y -i "$src" \
        -vf "scale=512:512:force_original_aspect_ratio=decrease" \
        -q:v 15 \
        "$dst" 2>/dev/null
}

total=0
compressed=0
failed=0

mkdir -p "$OUTPUT_DIR"

for chat_dir in "$INPUT_DIR"/*/; do
    chat_name=$(basename "$chat_dir")
    
    for media_type in voice photo video_note; do
        src_dir="$chat_dir/$media_type"
        [ -d "$src_dir" ] || continue
        
        dst_dir="$OUTPUT_DIR/$chat_name/$media_type"
        mkdir -p "$dst_dir"
        
        for src_file in "$src_dir"/*; do
            [ -f "$src_file" ] || continue
            total=$((total + 1))
            
            base=$(basename "$src_file")
            name="${base%.*}"
            
            case "$media_type" in
                voice)      dst_file="$dst_dir/${name}.opus" ;;
                photo)      dst_file="$dst_dir/${name}.jpg" ;;
                video_note) dst_file="$dst_dir/${name}.mp4" ;;
            esac
            
            if [ -f "$dst_file" ]; then
                continue  # already compressed
            fi
            
            case "$media_type" in
                voice)      compress_voice "$src_file" "$dst_file" ;;
                photo)      compress_photo "$src_file" "$dst_file" ;;
                video_note) compress_video_note "$src_file" "$dst_file" ;;
            esac
            
            if [ -f "$dst_file" ] && [ -s "$dst_file" ]; then
                compressed=$((compressed + 1))
                src_size=$(stat -c%s "$src_file" 2>/dev/null || echo 0)
                dst_size=$(stat -c%s "$dst_file" 2>/dev/null || echo 0)
                ratio=$(( (src_size - dst_size) * 100 / (src_size + 1) ))
                [ $((compressed % 100)) -eq 0 ] && echo "  [$compressed/$total] ${chat_name}/${media_type}/${base} (${ratio}% smaller)"
            else
                failed=$((failed + 1))
                [ $((failed % 10)) -eq 0 ] && echo "  ✗ Failed: ${chat_name}/${media_type}/${base}" >&2
            fi
        done
    done
done

echo ""
echo "=== Done ==="
echo "Total: $total | Compressed: $compressed | Failed: $failed"
echo "Output: $OUTPUT_DIR"

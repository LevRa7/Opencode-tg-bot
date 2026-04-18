#!/bin/bash
# Batch transcription script using Whisper STT API
# Processes .ogg and .mp4 files in parallel, batches up to 10

set -euo pipefail

STT_API_URL="${STT_API_URL:-http://192.168.2.166:1488/v1}"
STT_API_KEY="${STT_API_KEY:-}"
STT_MODEL="${STT_MODEL:-medium}"
STT_LANGUAGE="${STT_LANGUAGE:-ru}"
BATCH_SIZE="${BATCH_SIZE:-10}"
INPUT_DIR="${1:-.}"

if [[ -z "$STT_API_KEY" ]]; then
    echo "Error: STT_API_KEY not set" >&2
    exit 1
fi

find_files() {
    find "$INPUT_DIR" -type f \( -name "*.ogg" -o -name "*.mp4" \) ! -name "*.transcribed.*"
}

transcribe_file() {
    local file="$1"
    local output="${file}.transcribed.txt"
    
    if [[ -f "$output" ]]; then
        echo "[SKIP] Already transcribed: $file"
        return 0
    fi
    
    echo "[START] Transcribing: $file"
    
    local temp_output
    temp_output=$(mktemp)
    
    local response
    response=$(curl -s -X POST "${STT_API_URL}/audio/transcriptions" \
        -H "Authorization: Bearer ${STT_API_KEY}" \
        -F "file=@${file}" \
        -F "model=${STT_MODEL}" \
        -F "language=${STT_LANGUAGE}" \
        -F "response_format=text" \
        --max-time 300 \
        -o "$temp_output" \
        -w "%{http_code}")
    
    if [[ "$response" == "200" ]]; then
        mv "$temp_output" "$output"
        echo "[DONE] $file -> $output"
    else
        rm -f "$temp_output"
        echo "[FAIL] $file (HTTP $response)" >&2
        return 1
    fi
}
export -f transcribe_file
export STT_API_URL STT_API_KEY STT_MODEL STT_LANGUAGE

files=()
while IFS= read -r f; do
    files+=("$f")
done < <(find_files)

total=${#files[@]}
echo "Found $total files to transcribe (batch size: $BATCH_SIZE)"

if [[ $total -eq 0 ]]; then
    echo "No files to process"
    exit 0
fi

processed=0
errors=0

for ((i=0; i<total; i+=BATCH_SIZE)); do
    batch=("${files[@]:i:BATCH_SIZE}")
    batch_size=${#batch[@]}
    
    echo "Processing batch $((i/BATCH_SIZE + 1)) ($batch_size files)..."
    
    pids=()
    for file in "${batch[@]}"; do
        transcribe_file "$file" &
        pids+=($!)
    done
    
    for pid in "${pids[@]}"; do
        if ! wait "$pid"; then
            ((errors++))
        fi
        ((processed++))
    done
    
    echo "Progress: $processed/$total (errors: $errors)"
done

echo "Done. Processed: $processed, Errors: $errors"
exit $errors

#!/bin/bash
# Telegram Bot notification helper for WorldHistory project
# Usage:
#   ./telegram.sh send "Your message here"
#   ./telegram.sh ask "Question?" "Option1" "Option2" "Option3"
#   ./telegram.sh poll           # Check for latest reply

BOT_TOKEN="8609568721:AAH7y1VHGv5YcmWLR3S5QyzuD1GIMEPi6ps"
CHAT_ID="7523146464"
API="https://api.telegram.org/bot${BOT_TOKEN}"
LAST_UPDATE_FILE="/tmp/telegram_last_update_id"

send_message() {
    local text="$1"
    local reply_markup="$2"

    if [ -n "$reply_markup" ]; then
        curl -s -X POST "${API}/sendMessage" \
            -H "Content-Type: application/json" \
            -d "{\"chat_id\": ${CHAT_ID}, \"text\": \"${text}\", \"parse_mode\": \"Markdown\", \"reply_markup\": ${reply_markup}}" > /dev/null
    else
        curl -s -X POST "${API}/sendMessage" \
            -H "Content-Type: application/json" \
            -d "{\"chat_id\": ${CHAT_ID}, \"text\": \"${text}\", \"parse_mode\": \"Markdown\"}" > /dev/null
    fi
}

ask_question() {
    local question="$1"
    shift
    local buttons="["
    local first=true
    for opt in "$@"; do
        if [ "$first" = true ]; then
            first=false
        else
            buttons+=","
        fi
        buttons+="[{\"text\": \"${opt}\", \"callback_data\": \"${opt}\"}]"
    done
    buttons+="]"

    local markup="{\"inline_keyboard\": ${buttons}}"

    # Get current update_id to know where to start polling from
    local latest=$(curl -s "${API}/getUpdates?offset=-1" | sed -n 's/.*"update_id":\([0-9]*\).*/\1/p')
    if [ -n "$latest" ]; then
        echo $((latest + 1)) > "$LAST_UPDATE_FILE"
    fi

    curl -s -X POST "${API}/sendMessage" \
        -H "Content-Type: application/json" \
        -d "{\"chat_id\": ${CHAT_ID}, \"text\": \"${question}\", \"parse_mode\": \"Markdown\", \"reply_markup\": ${markup}}"
}

poll_response() {
    local offset=0
    if [ -f "$LAST_UPDATE_FILE" ]; then
        offset=$(cat "$LAST_UPDATE_FILE")
    fi

    local response=$(curl -s "${API}/getUpdates?offset=${offset}&timeout=30")

    # Check for callback query (button press)
    local callback_data=$(echo "$response" | sed -n 's/.*"callback_data":"\([^"]*\)".*/\1/p' | tail -1)
    if [ -n "$callback_data" ]; then
        # Acknowledge the callback
        local callback_id=$(echo "$response" | sed -n 's/.*"callback_query":{[^}]*"id":"\([^"]*\)".*/\1/p' | tail -1)
        if [ -n "$callback_id" ]; then
            curl -s "${API}/answerCallbackQuery?callback_query_id=${callback_id}" > /dev/null
        fi
        # Update offset
        local new_update_id=$(echo "$response" | sed -n 's/.*"update_id":\([0-9]*\).*/\1/p' | tail -1)
        if [ -n "$new_update_id" ]; then
            echo $((new_update_id + 1)) > "$LAST_UPDATE_FILE"
        fi
        echo "$callback_data"
        return 0
    fi

    # Check for text message
    local text=$(echo "$response" | sed -n 's/.*"text":"\([^"]*\)".*/\1/p' | tail -1)
    if [ -n "$text" ]; then
        local new_update_id=$(echo "$response" | sed -n 's/.*"update_id":\([0-9]*\).*/\1/p' | tail -1)
        if [ -n "$new_update_id" ]; then
            echo $((new_update_id + 1)) > "$LAST_UPDATE_FILE"
        fi
        echo "$text"
        return 0
    fi

    return 1
}

case "$1" in
    send)
        send_message "$2"
        ;;
    ask)
        shift
        ask_question "$@"
        ;;
    poll)
        poll_response
        ;;
    *)
        echo "Usage: $0 {send|ask|poll} [args...]"
        exit 1
        ;;
esac

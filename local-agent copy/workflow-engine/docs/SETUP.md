# C?i engine ?i k?m core

Xem [README package](../README.md) ?? c?i checkout ho?c xu?t g?i standalone c? lockfile. Engine ch?y ri?ng, ch?a c? supervisor/grant v2. HTTP polling control-server c? b? t?t.

T?i root core: `npm ci`, t?o `.env` local c?a engine t? example, c?u h?nh token r?i `npm run workflow:engine`. Dashboard ch? ? `http://127.0.0.1:34719`.

Scenario an to?n ?? ki?m tra: `fixture-wait`. Extension c?i th? c?ng t? sibling `chrome-reels-extension/`, ch?n ??ng profile trong Options. Sample `starter-browser` c?n extension. Kh?ng copy credential/Chrome profile/data gi?a m?y.

Video c?n yt-dlp, ffmpeg, ffprobe. N?u mu?n c?i tr?n Windows, ch?y `npm run setup:video -w @rca/workflow-engine` t?i root core c? ch? ??ch; script t?i executable v?o tools local. Kh?ng ch?y khi ch? ki?m tra workflow wait. C? th? ??t YTDLP_PATH/FFMPEG_PATH/FFPROBE_PATH trong c?u h?nh local.

CLI/API: [AUTOMATION_API](AUTOMATION_API.md). Scenario schema: [SCENARIOS](SCENARIOS.md). Storage/MongoDB: [ACTIVITY_STORAGE](ACTIVITY_STORAGE.md).

Startup v? migration l? l?nh t?y ch?n, kh?ng t? ch?y khi install/start; d?ng engine v? backup tr??c migration. V?i installation c?, ?u ti?n attach ??ng env/data hi?n t?i; kh?ng t? ??i machine ID. Windows Chrome/file picker c?n interactive user, kh?ng Session 0.

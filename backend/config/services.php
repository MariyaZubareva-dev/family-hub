<?php
return ['telegram'=>['bot_token'=>env('TELEGRAM_BOT_TOKEN')], 'openai'=>['key'=>env('OPENAI_API_KEY'), 'model'=>env('OPENAI_MODEL','gpt-4.1-mini')]];

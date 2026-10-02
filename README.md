# Pumpkin Latte Collector

Публичный репозиторий содержит только код браузерного сборщика. Данные Facebook, ключи, Supabase и Gemini здесь не хранятся.

## Установка bookmarklet

1. Откройте файл **BOOKMARKLET.txt**.
2. Нажмите **Raw**.
3. Ctrl+A -> Ctrl+C.
4. Создайте обычную закладку Chrome с названием **Pumpkin Collector**.
5. В поле URL вставьте скопированный текст целиком.

## Запуск

1. Откройте группу Facebook «Тыквенный латте».
2. Нажмите закладку **Pumpkin Collector**.
3. Появится панель **Pumpkin Latte Archive**.
4. Для первого реального теста поставьте лимит 20 и нажмите **Старт**.

Сборщик сохраняет данные только локально в IndexedDB браузера. В Supabase и Gemini сам bookmarklet ничего не отправляет.

Версия: pla-fb-archive-v2.1.0

# Сравнение эталона Глезер и Бура

## Проверенное происхождение

Пользователь указал `fix/longrun-feed-collector-v0.1.1/longrun-extension` как прежний коллектор. HEAD ветки ec8de84 (21 октября): manifest 0.1.1, core VERSION `pla-fb-archive-v2.8.4-longrun`.

Фактический старый JSON в Downloads: `pumpkin_latte_archive_2026-10-23T12-57-40-722Z.json`, SHA256 `d6698d887102436b769d4d26147ef88bf1f6a0ac116b823cba45b02de7be6aa0`. Версия внутри JSON и crawl: `pla-fb-archive-v2.8.5-longrun-safe`, schema_version 2. Экспортирован 23 октября в 12:57:40Z. Это совпадает с меткой исходников c0db6ad (12:25Z) и 47873c3 (12:29Z), линия manifest 0.1.2. Оба коммита оставили одинаковую метку версии. По одной метке нельзя доказать, какой из них реально стоял в браузере. IndexedDB накопительная; происхождение всех старых записей одной версией не подтверждено.

Числа проверены по файлу: 363 posts, 2793 authors, 358 posted_at, 5424 comments, 386 media. Ссылки author_key есть у 259 постов и 5131 комментария; битых ссылок на authors и posts нет. parent_comment_key не заполнен НИ У ОДНОГО комментария. `comments_complete=true` отмечено у 115 постов; это старый флаг, а не новая проверка полноты Facebook.

В 2792 authors есть числовой Facebook ID. ВСЕ 2792 ключа точно соответствуют `author:SHA256(facebook_author_id)`. Это проверено на реальном файле.

## Где найден нужный код

- `persistAuthor`: longrun-extension/core.js, строка 695 в ec8de84. Функция выбирает basis из Facebook ID либо group/name/profile, делает SHA256 и пишет отдельную запись authors с first/last_seen.
- `persistBundle`: строка 712. Сохраняет author_key на posts и comments, вложенный author удаляется; media получает owner_type/owner_key.
- `exportJson`: строка 1181. Выгружает массивы authors/posts/comments/media/errors и crawl отдельно из IndexedDB.
- История показывает ту же архитектуру persistAuthor ещё в коммите 886e82d от 2 октября, затем в longrun с 3693ef3 от 21 октября. Это не новая логика версии 0.1.1.
- Репозиторий pumpkin-latte-archive, HEAD f9c4fa6: docs/database-architecture.md описывает authors_private, posts/comments author references, parent_comment_id, media owner. Прочитаны миграции/документы локально; ничего не применялось.

## Что переносить и что проверять отдельно

| Возможность | Старый коллектор | Бур 0.5.23 | Направление изменения |
|---|---|---|---|
| Автор | Отдельный authors + стабильный key | Строка author/author_url в post/comment | Аддитивный authors/author_key при экспорте, без удаления прежних полей |
| Анонимность | Часть author_key отсутствует | Header fallback может принять произвольную строку | Явная анонимная метка без привязки к чужому профилю; unknown остаётся unknown |
| Даты | parseDate поддерживает relative, подставляет год/local noon; header fallback | Только time/abbr; почти все даты отсутствуют | Сохранять исходную метку и точность; не объявлять 358 старых дат точными timestamp |
| Комментарии | Накопление снимков, выбор All comments, guard активного поста | Накопление снимков и отдельная Deep-вкладка | Сохранить работающий Deep, отдельно добавить сортировку/показатели неполноты |
| Ответы | В эталонном экспорте 0 parent refs | Есть parent_id из reply_comment_id | Сохранить связи Бура, не переносить плоскую структуру эталона |
| Media | Отдельные owner_type/owner_key, photo/video/link/file | Массив img в посте, включая вложенные комментарии | Разделение владельцев, видео/ссылки, затем нормализованные media references |
| Группы | DB общий, export читает все stores без явной фильтрации по группе | key включает группу | Сохранить изоляцию Бура, отдельно проверить миграцию |
| Scroll/checkpoint | Собственный longrun, история отличается | Проверенный continuous feed + checkpoint-seek | Не заменять целиком старым кодом |
| Экспорт/облако | Синхронизация с production встроена | Локальный JSON, внешний watcher | Не переносить production sync; тестировать только изолированно |

## Внутренний candidate

Добавлен archive-graph.js: отдельные authors и author_key при экспорте, ключи числовых ID совместимы с проверенным legacy basis. Display-name-only identity привязана к владельцу, чтобы не объединять разных людей с одинаковым именем. Анонимная метка не становится общей личностью. Сохраняются старые поля Бура и исходные parent_id; добавляются post_key/parent_comment_key. Отсутствующий родитель отмечается явно.

Это пока экспортная проекция. Отдельный постоянный authors store, import mapping и интеграция с режимом пополнения ещё требуют завершения и тестов. Текущий candidate не выпущен.

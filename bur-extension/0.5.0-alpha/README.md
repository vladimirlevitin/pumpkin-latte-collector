# FB Бур 0.5.0-alpha

Дата: 25 октября 2026

## Статус

Архитектурный reset отказоустойчивости после живого провала 0.4.0.

Главный инвариант: обычная проблема одного deep-поста не должна останавливать всю очередь.

- popup / unexpected dialog во время deep -> failed текущего post_id -> следующий;
- удаленный/недоступный пост -> failed -> следующий;
- timeout deep -> failed -> следующий;
- неактивная вкладка сама по себе не ставит job на паузу;
- Facebook redirect служебной вкладки -> автоматический возврат к ожидаемому permalink;
- nested dialog wrappers одного permalink-поста разрешены;
- discovery popup -> ограниченное автоматическое восстановление ленты;
- discovery watchdog -> ограниченные автоматические перезагрузки.

Глобальная stalled-пауза остается только для действительно неустранимых условий: закрытая служебная вкладка или многократная невозможность восстановить ленту.

## Проверенный артефакт

Полный установочный ZIP сохранен на Google Drive:
https://drive.google.com/file/d/1yofmvqHzXb6BUUfOVKpn7kGWtztUQMim/view?usp=drivesdk

SHA256:
`768da8de624e7eab4130fab423cc2569e2700811e0bdb36655e4404714789493`

ZIP содержит исходники, тесты, README-RU.txt, QA-REPORT.txt, CHANGELOG.txt и SHA256SUMS.txt.

## Локальная QA

PASS:
- 53-post mixed-failure stress reaches done;
- inactive tab does not pause;
- deep popup and deleted post are per-post failures;
- redirect recovery;
- worker restart persistence;
- nested dialog regression;
- Chromium DOM/comment integration;
- popup/button semantics;
- scroll container tests.

## Что еще НЕ доказано

Живой Facebook на 0.5.0-alpha. Версия не считается рабочим релизом до одного автономного полевого прогона: Start -> discovery -> deep -> done -> JSON без ручного спасения обычных ошибок.

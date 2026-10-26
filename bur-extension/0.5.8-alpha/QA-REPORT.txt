FB БУР 0.5.8-alpha — DEEP STATE MACHINE + DIALOG CLASSIFIER
26 октября 2026 г.

Основание: живой прогон 0.5.7 на 50 постах backpackIL:
- 24 успешно, 26 ошибок;
- 16 ложных "Интерфейс Facebook перекрыл публикацию: подробное извлечение после раскрытия";
- 8 ложных "Facebook перенаправил на другую публикацию" из-за гонки N -> N+1;
- 2 таймаута >150 сек.

Исправлено:
1. Явные состояния deep: NAVIGATING -> READY -> EXPANDING.
2. Пока NAVIGATING, старый документ предыдущего поста не может пометить следующий пост ошибкой.
3. Несовпадение URL после READY обрабатывается через штатное bounded redirect recovery, а не мгновенный deepError.
4. Отдельный deepObstruction: вложенные/соседние comment/reply dialogs считаются частью рабочего интерфейса поста.
5. Login/checkpoint/gallery overlay по-прежнему считается настоящей помехой.
6. advanceDetail использует тот же deep-классификатор, чтобы ложный obstruction не возвращался после раскрытия.
7. Watchdog >150 сек теперь относится только к состоянию NAVIGATING; долгий полезный EXPANDING не убивается таймером навигации.

Добавлены регрессии:
- queue уже N+1, но старый document N ещё жив: deepErrors не увеличивается;
- nested reply dialog после раскрытия: deepObstruction == null;
- nested login dialog: deepObstruction != null.

Группа binding, parent_id, comment body, экспорт и структура очереди не менялись.
Живой Facebook после 0.5.8 ещё не проверен.

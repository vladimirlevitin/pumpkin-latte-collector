FB БУР 0.5.11-alpha — NESTED MEDIA POST DIALOG FIX
26 октября 2026 г.

Живой прогон 0.5.10: 48/50 успешно, 2 ошибки.
Обе ошибки одинаковые: вложенный media-dialog внутри уже распознанного target-post
имеет text_sample, начинающийся с "Публикация <author>...", но 0.5.10 считал
media:true достаточным признаком чужой галереи.

Исправлено:
- внутри target-post вложенный dialog с "Публикация ..." считается частью текущего поста;
- auth/login/checkpoint всё ещё блокируют;
- title-less media-dialog всё ещё блокирует как чужая галерея;
- очередь, state machine, group binding, parent_id, экспорт не менялись.

Добавлен regression:
- nested media + "Публикация Daria..." => deepObstruction == null;
- nested media без "Публикация ..." => deepObstruction != null.

FB БУР 0.5.11-alpha — LIVE POST-TITLE DIALOG FIX
26 октября 2026 г.

Основание: живой прогон 0.5.9 на 50 постах backpackIL:
- stage done, 40/50 успешно, 10 deep errors;
- все 10 ошибок одного класса;
- diagnostics во всех случаях показывают сам dialog текущей публикации:
  text_sample начинается с "Публикация <автор>";
- coverage 53-99%, media true/false;
- это не login/checkpoint и не чужая галерея.

Исправлено:
1. На уже подтверждённом permalink URL detailDialog принимает большой Facebook dialog,
   если его видимый текст начинается с "Публикация ..." или "Post ...".
2. Старые сильные признаки (body/article/matching permalink/textbox) сохранены.
3. Настоящая photo-only галерея по-прежнему не считается detail post.
4. deepObstruction продолжает проверять вложенные чужие dialogs.
5. Fallback 0.5.9 для подтверждённого URL сохранён.

Добавлена живая регрессия:
- title-only dialog "Публикация Альона Шанигіна" на подтверждённом permalink
  обязан распознаваться как target detail dialog и не давать obstruction.

Очередь, group binding, parent_id, экспорт и deep state machine не менялись.

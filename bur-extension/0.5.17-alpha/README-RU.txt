FB БУР 0.5.16-alpha — AUTH FALSE POSITIVE FIX
26 октября 2026 г.

Корень двух воспроизводимых ошибок найден отдельным двухпостовым щупом.

Пост Daria Afonin Zolotina содержал обычную фразу "Вход бесплатный".
Пост Yevgeny Frenkel содержал фразу "скоростью входы частиц".
Старый auth-detector искал голое русское слово "вход" как подстроку и поэтому
ошибочно помечал сам post-dialog как окно авторизации.

Исправлено:
- голое "вход" больше не считается auth;
- русская auth-фраза требует контекста: "вход в/на аккаунт, систему, Facebook, Meta";
- "войти", login, sign in, checkpoint, verify your account и др. сохранены;
- вся остальная deep/dialog/queue логика не менялась.

Regression:
- "Вход бесплатный" => НЕ auth / НЕ obstruction;
- "скоростью входы частиц" => НЕ auth / НЕ obstruction;
- "Вход в аккаунт Facebook" => auth / obstruction;
- существующий "Log in to continue" => obstruction.

FB БУР 0.5.16-alpha — URL IDENTITY CONSISTENCY FIX
26 октября 2026 г.

Живой прогон 0.5.12: 48/50 успешно, 2 ошибки.
Обе ошибки снова были самими текущими публикациями, ошибочно распознанными как obstruction.

Корень:
- core.getPostId() принимал более широкий набор URL текущего поста;
- feed-scroll.detailDialog() требовал только строгий /groups/<group>/posts/<id>/;
- при более сложном URL getPostId() подтверждал нужный post_id, но detailDialog() возвращал null;
- deepObstruction() затем откатывался к generic obstruction() и объявлял сам post-dialog препятствием.

Исправлено:
- detailDialog() использует совместимую URL-идентификацию;
- поддержаны group post URL с дополнительным хвостом пути;
- поддержан story_fbid;
- matching permalink теперь сравнивается по post_id/group, а не по полному pathname;
- diagnostics теперь сохраняет current_url и target_found.

Добавлены regressions для URL с хвостом и story_fbid.
Очередь, group binding, parent_id, экспорт и state machine не менялись.

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


0.5.16-alpha — пакетное продолжение
- После завершения пакета Бур сохраняет последний post_id отдельно для каждой группы.
- Следующий «Начать» сначала ищет эту контрольную точку в ленте и не сохраняет повторно уже пройденные посты.
- Контрольная публикация пропускается; новый пакет начинается строго со следующей.
- Если контрольная точка не найдена, сбор останавливается, чтобы не образовать скрытый пропуск.
- Завершённое задание предыдущей версии автоматически мигрируется в checkpoint, если chrome.storage сохранился при обновлении расширения.


0.5.16-alpha — восстановление точки после переустановки
- В popup есть поле «Начать после post_id» для явного задания границы.
- Явная граница имеет приоритет над старым/пустым внутренним хранилищем.
- Checkpoint дублируется в localStorage facebook.com для каждой группы и восстанавливается после переустановки расширения.
- После завершения пакета обе копии автоматически заменяются последним post_id очереди.
- Если checkpoint не найден в ленте, сбор безопасно останавливается.

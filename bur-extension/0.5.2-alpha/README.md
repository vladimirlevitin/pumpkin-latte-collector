# FB Bur 0.5.2-alpha

Date: 2026-10-25

Live evidence from 0.5.1:
- stage=done
- 53 discovered
- 40 deep_done
- 13 deep_errors
- 201 unique comments
- author non-null: 0
- parent_id non-null: 0
- all 8/8 posts with “Посмотреть/Показать N ответов” failed deep

0.5.2 fixes:
- collector-owned reply/comment dialogs are harvested and closed automatically
- reply identity prefers reply_comment_id over parent comment_id
- /groups/.../user/<id> author links are accepted
- nested replies receive parent_id from nearest parent comment article
- permalink pages without role=article get a conservative post-root fallback
- deep opens one expansion control per cycle

QA:
- existing worker/scroll/modal/content/popup regressions PASS
- new nested reply/author regression PASS
- new reply-dialog integration regression PASS
- new permalink fallback regression PASS

Full verified ZIP:
https://drive.google.com/file/d/1J7SItBJAdFH6r7JM1ifoXgi__TRI6S-P/view?usp=drivesdk

SHA256:
89a33577f1727a882cd195d9e951b3b83e52c9927962d52f0fabf2d15de2a616

Live Facebook 0.5.2 has not yet been verified.

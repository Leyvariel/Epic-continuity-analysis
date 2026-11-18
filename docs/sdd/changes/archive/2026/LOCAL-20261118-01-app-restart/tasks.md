---
change_id: LOCAL-20261118-01
status: implemented
updated: 2026-11-18
language: ru
---

# Задачи перезапуска

- [x] T001 [repo:.] [req:FR-060,FR-061,FR-062,AC-160,AC-161,AC-162,AC-163] Воспроизвести отсутствие перезапуска и определить проверки API, клиента и интерфейса | path: `tests/restart-api.test.ts` | verify: `npm test -- --run tests/restart-api.test.ts tests/restart-client.test.ts tests/restart-ui.test.tsx` | depends: none
- [x] T002 [repo:.] [req:FR-060,FR-061,FR-062,AC-160,AC-161,AC-162,AC-163] Реализовать управляемый перезапуск сервера и кнопку с ожиданием | path: `server/runtime.ts` | verify: `npm test -- --run tests/restart-api.test.ts tests/restart-client.test.ts tests/restart-ui.test.tsx tests/restart-runtime.test.ts` | depends: T001
- [x] T003 [repo:.] [req:FR-060,FR-061,FR-062,AC-160,AC-161,AC-162,AC-163] Проверить браузер, регрессию и перенести подтверждённое поведение в текущую SDD | path: `docs/sdd/specs/application-runtime.md` | verify: `npm run check; node scripts/verify-restart-browser.mjs docs/sdd/changes/archive/2026/LOCAL-20261118-01-app-restart/evidence/visual; python3 /Users/leyva/.agents/skills/sdd-writer/scripts/validate_sdd.py .` | depends: T002
- [x] T004 [repo:.] [req:FR-060,FR-061,FR-062,AC-160,AC-161,AC-162,AC-163] Оформить постфактум трассировку TDD/BDD и сверку этапов разработки с сохранением исторических ограничений | path: `docs/sdd/changes/archive/2026/LOCAL-20261118-01-app-restart/workflow-review.md` | verify: `npm run check; python3 /Users/leyva/.agents/skills/sdd-writer/scripts/validate_sdd.py .` | depends: T003

## Уточнение истории выполнения

T001 подтверждает предварительный падающий запуск API и отсутствие клиентского модуля. UI и проверки настоящего процесса добавлены после реализации в ходе T002; их предварительный падающий запуск не зафиксирован. Отметки T001–T003 означают выполненный результат в указанном объёме и не доказывают полный предварительный TDD на всех уровнях. Подробная трассировка — в [плане и фактическом выполнении](test-plan.md).

T004 добавлена по отдельному поручению пользователя оформить работу постфактум 18.11.2026. Она изменяет документацию, а не поведение приложения. [Сверка этапов](workflow-review.md) сохраняет отсутствие предварительного плана и отдельного утверждения proposal/design.

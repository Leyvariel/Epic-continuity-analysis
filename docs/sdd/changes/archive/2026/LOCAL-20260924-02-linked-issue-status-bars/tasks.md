---
change_id: LOCAL-20260924-02
status: approved
design: ./design.md
updated: 2026-11-11
language: ru
---

# Задачи изменения

Пользователь согласовал пакет и разрешил реализацию сообщением «Приступай к реализации». До T001 выполнены строгая проверка `--ready`, сверка 84 исходных файлов и локальная резервная копия исходников/кэша.

T001–T016 завершены. 11.11.2026 пользователь принял управляемый повтор живых историй без словаря категорий как достаточную проверку резервного расчёта и подтвердил архивирование. T012 закрыта в согласованном объёме; естественный отказ справочника не объявляется наблюдавшимся. T013 подтверждена в реальном Chrome на автономной XLSX; T015 завершена после проверки ссылок и переноса пакета. [Приёмка](acceptance-20261111.md), [решение об архивировании](archive.md).

## Реализация и проверка

- [x] T001 [repo:.] [req:FR-034,AC-046] Определить версионированные входы и производную модель иерархии со строгой проверкой и состоянием старого кэша | path: `shared/hierarchy.ts` | verify: `npx vitest run tests/hierarchy-contracts.test.ts` | depends: none

- [x] T002 [repo:.] [req:FR-031,FR-032,AC-033,AC-040,AC-043] Расширить чтение Jira доказанными сторонами связей, типом подзадачи и категорией статуса на срезе с проверкой распознанных и неизвестных значений | path: `server/jira/adapter.ts` | verify: `npx vitest run tests/hierarchy-adapter.test.ts tests/jira-adapter.test.ts` | depends: T001

- [x] T003 [repo:.] [req:FR-030,NFR-001,AC-035,AC-036,AC-037,AC-039] Построить конечную проекцию веток с общими детьми, ограниченным обходом скрытых исключённых узлов и ленивыми путями | path: `shared/hierarchy-view.ts` | verify: `npx vitest run tests/hierarchy-view.test.ts` | depends: T001

- [x] T004 [repo:.] [req:FR-032,AC-040,AC-041,AC-042,AC-043] Рассчитать дочерние интервалы от создания независимо от HF и флагов, включая создание после среза и ровно на срезе | path: `server/related-timeline.ts` | verify: `npx vitest run tests/related-timeline.test.ts tests/timeline.test.ts tests/jira-domain.test.ts` | depends: T001

- [x] T005 [repo:.] [req:FR-031,NFR-001,FR-034,AC-034,AC-038,AC-039,AC-047] Встроить сбор графа и историй Jira в существующее задание с общим срезом и ограниченной очередью | path: `server/jira/hierarchy.ts` | verify: `npx vitest run tests/hierarchy-jira.test.ts tests/concurrency.test.ts tests/keys-service.test.ts` | depends: T002,T003,T004

- [x] T006 [repo:.] [req:FR-033,FR-034,AC-044,AC-045] Разобрать дополнение автономной книги и доступные дочерние истории без сети, сохранив прежние книги | path: `server/table-hierarchy.ts` | verify: `npx vitest run tests/hierarchy-xlsx.test.ts tests/import.test.ts tests/table-history.test.ts tests/file-candidates.test.ts` | depends: T001,T003,T004

- [x] T007 [repo:.] [req:FR-030,NFR-001,AC-029,AC-030,AC-031,AC-032,AC-035,AC-037,AC-039] Добавить доступное раскрытие по путям, дочерние строки без чисел и порционное отображение на общей оси допустимых элементов | path: `src/HierarchyRows.tsx` | verify: `npx vitest run tests/hierarchy-ui.test.tsx tests/calendar.test.ts tests/layout.test.ts` | depends: T003,T004

- [x] T008 [repo:.] [req:FR-030,FR-033,AC-032,AC-044,AC-045] Подключить выбор автономной книги и состояния иерархии к приложению и существующему API | path: `src/App.tsx` | verify: `npx vitest run tests/hierarchy-source.test.tsx tests/ui.test.tsx tests/keys-ui.test.tsx tests/api.test.ts` | depends: T005,T006,T007

- [x] T009 [repo:.] [req:FR-031,FR-032,FR-033,FR-034,AC-034,AC-038,AC-040,AC-043,AC-045,AC-046,AC-047] Согласовать сохранение и восстановление обеих веток набора, обновление и откат на временном кэше | path: `server/cache.ts` | verify: `npx vitest run tests/hierarchy-cache.test.ts tests/cache-v3.test.ts tests/jira-service.test.ts` | depends: T005,T006,T008

- [x] T010 [repo:.] [req:FR-030,FR-031,FR-032,FR-033,FR-034,NFR-001,AC-029,AC-030,AC-031,AC-032,AC-033,AC-034,AC-035,AC-036,AC-037,AC-038,AC-039,AC-040,AC-041,AC-042,AC-043,AC-044,AC-045,AC-046,AC-047] Проверить сценарии приёмки по применимости источников в BDD, общие сценарии на обоих полных потоках, и связать результаты с протоколом | path: `tests/hierarchy-flow.test.tsx` | verify: `npx vitest run tests/hierarchy-flow.test.tsx` | depends: T009

- [x] T011 [repo:.] [req:FR-030,FR-031,FR-032,FR-033,FR-034,NFR-001] Выполнить регрессию и сборку, сохранив коды завершения и фактическое число проверок | path: `docs/sdd/changes/archive/2026/LOCAL-20260924-02-linked-issue-status-bars/verification.md` | verify: `npm run check` | depends: T010

- [x] T012 [repo:.] [req:FR-031,FR-032,AC-033,AC-034,AC-040,AC-041,AC-043,AC-048] Сверить направление, типы, категории закрытия и даты полос с реальным разрешённым набором Jira | path: `docs/sdd/changes/archive/2026/LOCAL-20260924-02-linked-issue-status-bars/verification.md` | verify: `Протокол живой сверки с ключами и датами без секретов по bdd-scenarios.md` | depends: T011,T016

- [x] T013 [repo:.] [req:FR-030,FR-033,AC-029,AC-030,AC-031,AC-032,AC-035,AC-044] Проверить отрисовку и управление в браузере на автономном примере во всех масштабах | path: `docs/sdd/changes/archive/2026/LOCAL-20260924-02-linked-issue-status-bars/verification.md` | verify: `Снимки календаря и протокол клавиатуры/прокрутки по bdd-scenarios.md` | depends: T011

- [x] T014 [repo:.] [req:FR-030,FR-031,FR-032,FR-033,FR-034,NFR-001] Перенести проверенные дельты в текущую SDD и обновить описание автономного формата и интерфейса | path: `docs/SDD.md` | verify: `python3 /Users/leyva/.agents/skills/sdd-writer/scripts/validate_sdd.py .` | depends: T011,T016

- [x] T015 [repo:.] [req:FR-030,FR-031,FR-032,FR-033,FR-034,NFR-001] Подвести итог и архивировать полный пакет после проверки результатов и входящих ссылок | path: `docs/sdd/changes/archive/2026/LOCAL-20260924-02-linked-issue-status-bars` | verify: `Протокол завершения, разрешение ссылок и проверка зависимости workflow; остатки допускаются только по явному решению пользователя` | depends: T014

- [x] T016 [repo:.] [req:FR-005,FR-030,FR-031,NFR-001,AC-003,AC-048] Включить стандартный состав Epic Link, доказать полноту страниц, объединение и безопасные отказы, проверить раскрытие обоих уровней | path: `server/jira/adapter.ts` | verify: `npx vitest run tests/epic-membership.test.ts tests/keys-flow.test.tsx tests/hierarchy-view.test.ts tests/jira-domain.test.ts` | depends: T002,T005,T008

## Границы завершения

Автоматические сценарии, живая Jira и визуальная приёмка подтверждают результат в объёме [протокола 11.11.2026](acceptance-20261111.md). Для недоступной категории пользователь принял управляемый повтор реальных историй без словаря вместо ожидания естественного случая. Это согласованная граница свидетельства, а не утверждение о наблюдавшемся отказе Jira. Незавершённых задач пакета нет; остатки других пакетов этим решением не закрываются.

Полное описание затронутых файлов и механизмов — в [дизайне](design.md), последовательность тестов — в [плане TDD](tdd-plan.md).

---
change_id: LOCAL-20261103-01
status: approved
design: ./design.md
updated: 2026-11-03
language: ru
---

# Задачи поправки таблицы

- [x] T001 [repo:.] [req:FR-030,FR-046,AC-029,AC-030,AC-031,AC-032,AC-035,AC-036,AC-037,AC-105,AC-106,AC-120,AC-101,AC-102,AC-114,AC-138] Зафиксировать регрессии выбора колонок и дочерних строк падающими проверками | path: `tests/expanded-hierarchy.test.ts` | verify: `npm test -- tests/expanded-hierarchy.test.ts tests/hierarchy-ui.test.tsx tests/sprint-focus-ui.test.tsx tests/hypothesis-columns-ui.test.tsx` | depends: none
- [x] T002 [repo:.] [req:FR-030,FR-046,AC-114,AC-138] Ограничить числовую таблицу корнями, сохранив дочерние полосы | path: `shared/metrics.ts` | verify: `npm run check` | depends: T001
- [x] T003 [repo:.] [req:FR-030,FR-046,AC-029,AC-030,AC-032,AC-105,AC-106,AC-120,AC-101,AC-102,AC-114,AC-138] Проверить реальные состояния браузера и неизменность сохранённого набора | path: `scripts/verify-hypothesis-columns-browser.mjs` | verify: `evidence/visual/browser-report.json и просмотр снимков` | depends: T002
- [x] T004 [repo:.] [req:FR-030,FR-046] Перенести проверенную дельту в текущую SDD и сохранить итог | path: `docs/sdd/specs/visualization.md` | verify: `python3 /Users/leyva/.agents/skills/sdd-writer/scripts/validate_sdd.py .` | depends: T003

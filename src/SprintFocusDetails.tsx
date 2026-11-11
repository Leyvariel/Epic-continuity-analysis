import type {SprintRow,SprintInterval} from '../shared/sprints';
import {DAY_MS} from '../shared/statuses';
import {dateTime} from '../shared/calendar';
import {SPRINT_LABELS} from './SprintRows';
const days=(n:number|null)=>n===null?'—':new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n/DAY_MS)+' дн.';
const dates=(s:SprintInterval)=>`${dateTime(s.start)} → ${dateTime(s.end)} МСК`;
export function SprintFocusDetails({row,asOf}:{row?:SprintRow;asOf:string}) {
 const f=row?.focus;
 return <section className="sprint-focus-details" aria-label="Расчёт времени без работы">
  <h3>Без работы</h3>
  {!f?<p>Спринты не загружены или расчёт недоступен для этой гипотезы.</p>:<>
   <p className="focus-total"><strong>{days(f.totalMs)}</strong>{f.state==='preliminary'&&' · предварительно'} · срез {dateTime(asOf)} МСК</p>
   {f.reasons.length>0&&<ul className="panel-warnings">{f.reasons.map(r=><li key={r}>{r}</li>)}</ul>}
   {f.cycles.length>0&&<>
    <dl><dt>Периоды без Отложено</dt><dd>{days(f.windowMs)}</dd><dt>Исключено Отложено</dt><dd>{days(f.deferredMs)}</dd>
     <dt>Область оценки</dt><dd>{f.scope==='cycle'?'Весь цикл: все задачи без спринтов':'Внутри известных спринтов'}</dd><dt>Исключено вне спринтов</dt><dd>{days(f.outsideSprintMs)}</dd><dt>Оценённое время</dt><dd>{days(f.evaluatedMs)}</dd>
     <dt>Покрыто работой</dt><dd>{days(f.coveredMs)}</dd><dt>Без работы · завершённая часть</dt><dd>{days(f.closedMs)}</dd><dt>Без работы · предварительная часть</dt><dd>{days(f.preliminaryMs)}</dd></dl>
    {f.state==='unknown'&&<p>Известные части не являются полным итогом.</p>}
    <details><summary>Циклы реализации ({f.cycles.length})</summary><ol>{f.cycles.map((s,i)=><li key={i}>{dates(s)}</li>)}</ol></details>
    <details><summary>Интервалы без работы и неизвестности</summary>
     {f.withoutWork.map((s,i)=><p key={`n${i}`}>Без работы: {dates(s)}</p>)}
     {f.preliminary.map((s,i)=><p key={`p${i}`}>Предварительная часть: {dates(s)}</p>)}
     {f.unknown.map((s,i)=><p key={`u${i}`}>Неизвестно: {dates(s)}</p>)}
     {!f.withoutWork.length&&!f.unknown.length&&<p>Интервалов без работы не обнаружено.</p>}
    </details>
    {!!row?.activity?.length&&<details className="exact-work-details"><summary>Работа без спринтов ({row.activity.length})</summary><ul>{row.activity.map(a=><li key={a.taskKey}>
     <a href={`https://hq.tutu.ru/browse/${encodeURIComponent(a.taskKey)}`} target="_blank" rel="noreferrer">{a.taskKey}</a>
     {a.subtaskKeys.length>0&&<span> · подзадачи: {a.subtaskKeys.join(', ')}</span>}
     {a.intervals.map((s,i)=><p key={i}>Активный статус: {dates(s)}</p>)}
     {a.unknown.map((s,i)=><p key={`u${i}`}>Неизвестно: {dates(s)}</p>)}
     {!a.intervals.length&&!a.unknown.length&&<p>Активных интервалов до среза нет.</p>}
    </li>)}</ul></details>}
    <details><summary>Спринты и подтверждения работы</summary><ul className="focus-sprint-list">{row!.segments.filter(s=>f.cycles.some(c=>s.start<c.end&&c.start<s.end)).map(s=><li key={s.sprintId}>
     <strong>{s.name} · Sprint {s.sprintId}</strong><br/>{dates(s)}<br/>{SPRINT_LABELS[s.state]}
     {[...s.taskKeys,...s.subtaskKeys].length>0&&<div>{[...s.taskKeys,...s.subtaskKeys].map(key=><a key={key} href={`https://hq.tutu.ru/browse/${encodeURIComponent(key)}`} target="_blank" rel="noreferrer">{key} ↗ </a>)}</div>}
    </li>)}</ul></details>
   </>}
  </>}
  <p>Включение задачи без работы устраняет прежнюю тёмную отметку, но не время без работы в этой метрике. Даже короткая подтверждённая работа покрывает целый спринт. Работа задач из TEXT, CONTENT, MLE и UX без спринтов покрывает только точные активные интервалы. Их пересечения учитываются один раз. Это оценка непрерывности работы, а не трудозатраты.</p>
 </section>;
}

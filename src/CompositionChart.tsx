import { compositionFor } from '../shared/composition';
import type { compositionScale, Composition } from '../shared/composition';
import type { MetricColumn } from '../shared/metrics';
import { DAY_MS } from '../shared/statuses';
import { preciseDuration } from '../shared/calendar';
import type { EpicTimeline } from '../shared/types';

export const COMPOSITION_WIDTH = 660;
const PADDING = 24;
const PLOT_WIDTH = COMPOSITION_WIDTH - 2 * PADDING;
type Scale = ReturnType<typeof compositionScale>;
const format = (ms: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(ms / DAY_MS);
const position = (ms: number, scale: Scale) => PADDING + ms / scale.maxMs * PLOT_WIDTH;

export function CompositionHeader({ scale }: { scale: Scale }) {
  return <div className="composition-header" style={{ width: COMPOSITION_WIDTH }}>
    <strong>Состав длительностей · дни</strong>
    <span>Порядок колонок Excel · общая шкала для всех эпиков</span>
    <div className="composition-axis">{scale.ticks.map(tick => <span key={tick} style={{ left: position(tick, scale) }} title={preciseDuration(tick)}>{format(tick)}</span>)}</div>
  </div>;
}

function summary(item: Composition) {
  const total = item.totalMs === null ? 'нет значений' : `${format(item.totalMs)} дн.`;
  return `Σ ${item.missing.length ? 'известных этапов' : 'этапов'}: ${total} · TTM: ${item.ttmMs === null ? 'нет данных' : `${format(item.ttmMs)} дн.`}`;
}

export function CompositionBar({ epic, columns, scale, onSelect }: { epic: EpicTimeline; columns: MetricColumn[]; scale: Scale; onSelect: () => void }) {
  const item = compositionFor(epic, columns);
  const tooltip = `${summary(item)}\n${item.segments.map(segment => `${segment.name}: ${preciseDuration(segment.durationMs)}`).join('\n')}${item.missing.length ? `\nНет значений: ${item.missing.map(column => column.name).join(', ')}` : ''}\nЭто состав суммарных длительностей, а не история переходов.`;
  return <div className="composition-body" style={{ width: COMPOSITION_WIDTH }}>
    {scale.ticks.map(tick => <span className="composition-gridline" key={tick} style={{ left: position(tick, scale) }} />)}
    <button className="composition-summary" onClick={onSelect} title={tooltip}>{summary(item)}</button>
    <button className="composition-plot" aria-label={`${epic.summary.key}. ${tooltip}`} title={tooltip} onClick={onSelect}>
      {item.segments.map(segment => {
        const width = segment.durationMs / scale.maxMs * PLOT_WIDTH;
        return <span key={segment.id} className={`composition-segment ${segment.unknown ? 'hatch' : ''}`} style={{ left: position(segment.offsetMs, scale), width, backgroundColor: segment.color, color: segment.text }}>
          {width >= 28 && (segment.unknown && width >= 90 ? segment.name : segment.code)}
        </span>;
      })}
      {item.ttmMs !== null && <span className="composition-ttm" style={{ left: position(item.ttmMs, scale) }}><span>TTM</span></span>}
      {item.totalMs === null && <span className="composition-empty">Нет длительностей этапов</span>}
      {item.totalMs === 0 && <span className="composition-empty">Предоставленные длительности равны нулю</span>}
    </button>
    <div className="composition-caption">{item.missing.length ? `Нет значений в ${item.missing.length} колонках · ` : ''}Открыто исключено из состава · подробности по нажатию</div>
  </div>;
}

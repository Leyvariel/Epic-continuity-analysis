import { position } from './calendar';
import type { StatusInterval } from './types';

export function segmentLabels(intervals: StatusInterval[], rangeStart: number, pixelsPerDay: number) {
  const lanes: number[] = [];
  return intervals.map(segment => {
    const left = position(Date.parse(segment.start), rangeStart, pixelsPerDay);
    const width = position(Date.parse(segment.end), rangeStart, pixelsPerDay) - left;
    const labelWidth = Math.max(27, segment.code.length * 7 + 12);
    const narrow = width < Math.max(17, segment.code.length * 7 + 8);
    let labelLeft = left, lane = 0;
    if (narrow) {
      lane = lanes.findIndex(end => end + 4 <= left);
      if (lane < 0) lane = lanes.length < 3 ? lanes.length : lanes.indexOf(Math.min(...lanes));
      labelLeft = Math.max(left, (lanes[lane] ?? -4) + 4);
      lanes[lane] = labelLeft + labelWidth;
    }
    return { left, width, narrow, labelLeft, labelWidth, lane };
  });
}

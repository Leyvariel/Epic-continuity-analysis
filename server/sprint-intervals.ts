import type { SprintInterval } from '../shared/sprints';
export type Span=[number,number];
const iso=(n:number)=>new Date(n).toISOString();
const overlaps=(a:Span,b:Span)=>a[0]<b[1]&&b[0]<a[1];
export function mergeSpans(spans:Span[]):Span[]{const out:Span[]=[];for(const [a,b] of spans.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&a<b).sort((x,y)=>x[0]-y[0]||x[1]-y[1])){const last=out.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else out.push([a,b]);}return out;}
export const intersect=(a:Span[],b:Span[])=>mergeSpans(a.flatMap(x=>b.filter(y=>overlaps(x,y)).map(y=>[Math.max(x[0],y[0]),Math.min(x[1],y[1])] as Span)));
export function subtractSpans(a:Span[],b:Span[]):Span[]{let out=mergeSpans(a);for(const [c,d] of mergeSpans(b))out=out.flatMap(([x,y])=>d<=x||c>=y?[[x,y]]:([[x,Math.min(y,c)],[Math.max(x,d),y]] as Span[]).filter(([l,r])=>l<r));return out;}
export const asIntervals=(spans:Span[]):SprintInterval[]=>mergeSpans(spans).map(([a,b])=>({start:iso(a),end:iso(b)}));

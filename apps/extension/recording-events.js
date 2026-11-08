import { validTarget } from './skill-learning.js';
// The recorder's event content check. Shared with dataset-recording.js so imported recordings face the same rule.
export function validEvent(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['kind','tag','x','y','key','target','formTargets'].includes(key))) return false;
  return (value.formTargets===undefined || (value.kind==='click' && Array.isArray(value.formTargets) && value.formTargets.length<=12 && value.formTargets.every(target=>validTarget(target) && ['INPUT','SELECT','TEXTAREA'].includes(target.tag))))
    && (value.target===undefined || (['click','change'].includes(value.kind) && validTarget(value.target)))
    && ['click','change','submit','scroll','page-visible','pointer','key'].includes(value.kind)
    && ['INPUT','SELECT','TEXTAREA','BUTTON','A','FORM','PAGE','OTHER'].includes(value.tag)
    && ((value.x === undefined && value.y === undefined) || (['pointer','click'].includes(value.kind) && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x>=0 && value.x<=1 && value.y>=0 && value.y<=1))
    && (value.key === undefined || (value.kind === 'key' && ['Tab','Enter','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(value.key)));
}

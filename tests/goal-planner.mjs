import assert from 'node:assert/strict';
import { planGradeGoal, roundRequiredGrade } from '../js/grading.js';
const scale={minimum:0,maximum:100,passing:75,direction:'higher'};
const final=g=>(g.prelim*30+g.midterm*30+g.endterm*40)/100;
function verify(result, recorded, target, selectedScale=scale) {
  for(const plan of [...result.plans,...(result.scenario?.feasible?[result.scenario]:[])]) {
    assert.equal(plan.feasible,true);
    for(const term of ['prelim','midterm','endterm']) {
      assert.ok(plan.grades[term]>=selectedScale.minimum && plan.grades[term]<=selectedScale.maximum);
      if(recorded[term]!==null && recorded[term]!==undefined) assert.equal(plan.grades[term],recorded[term]);
      else if(result.wholeNumbers) assert.equal(Number.isInteger(plan.grades[term]),true);
    }
    const predicted=final(plan.grades);
    assert.equal(predicted,plan.predicted);
    assert.ok(selectedScale.direction==='lower'?predicted<=target:predicted>=target,JSON.stringify({plan,target}));
  }
}
for(const [prelim,midterm,target,endterm] of [[85,90,90,93.75],[80,80,85,92.5],[90,90,90,90],[70,75,80,91.25],[95,95,90,82.5]]) {
  const result=planGradeGoal({prelim,midterm},target,scale);
  assert.equal(result.scenario.grades.endterm,endterm); verify(result,{prelim,midterm},target);
}
const empty=planGradeGoal({},90,scale);
assert.deepEqual(empty.scenario.grades,{prelim:90,midterm:90,endterm:90});verify(empty,{},90);
const recorded={prelim:85};
const before=JSON.stringify(recorded);
const balanced=planGradeGoal(recorded,90,scale);
assert.equal(balanced.scenario.grades.midterm,92.15);
assert.equal(balanced.scenario.grades.endterm,92.15);
assert.ok(balanced.plans.some(p=>p.label==='Midterm-Focused Plan'));
assert.ok(balanced.plans.some(p=>p.label==='Endterm-Focused Plan'));
for(const [midterm,endterm] of [[85,97.5],[90,93.75],[95,90],[100,86.25]]) {
  const result=planGradeGoal(recorded,90,scale,{planned:{midterm},driver:'midterm'});
  assert.equal(result.scenario.grades.endterm,endterm);verify(result,recorded,90);
}
assert.equal(JSON.stringify(recorded),before);
const reverse=planGradeGoal(recorded,90,scale,{planned:{endterm:90},locked:['endterm']});
assert.equal(reverse.scenario.grades.midterm,95);
const impossiblePlan=planGradeGoal(recorded,90,scale,{planned:{midterm:50},locked:['midterm']});
assert.equal(impossiblePlan.status,'achievable');assert.equal(impossiblePlan.scenario.feasible,false);
assert.equal(planGradeGoal({prelim:10},90,scale).status,'unreachable');
assert.equal(planGradeGoal({prelim:100,midterm:100},50,scale).status,'secured');
assert.equal(planGradeGoal({prelim:85,midterm:95,endterm:90},90,scale).status,'achieved');
assert.equal(planGradeGoal({prelim:85,midterm:90,endterm:90},90,scale).status,'below');
const unexpected=planGradeGoal({midterm:95,endterm:90},90,scale);
assert.equal(unexpected.scenario.grades.prelim,85);verify(unexpected,{midterm:95,endterm:90},90);
const whole=planGradeGoal({prelim:85,midterm:90},90,scale,{wholeNumbers:true});
assert.equal(whole.scenario.grades.endterm,94);verify(whole,{prelim:85,midterm:90},90);
const decimal=planGradeGoal({prelim:85.5,midterm:90.25},90.1,scale);
assert.equal(decimal.scenario.grades.endterm,93.44);verify(decimal,{prelim:85.5,midterm:90.25},90.1);
assert.equal(roundRequiredGrade(93.43000000000001,scale),93.43);
for(const invalid of ['',NaN,Infinity,-1,101,'x',null]) assert.equal(planGradeGoal(recorded,invalid,scale).status,'invalid');
assert.equal(planGradeGoal({prelim:'oops'},90,scale).status,'invalid');
assert.equal(planGradeGoal({prelim:''},90,scale).status,'achievable');
const lower={minimum:1,maximum:5,passing:3,direction:'lower'};
for(const actual of [{},{prelim:2},{midterm:4},{prelim:2,midterm:4},{endterm:3}]) verify(planGradeGoal(actual,3,lower),actual,3,lower);
assert.equal(planGradeGoal({prelim:1,midterm:1},3,lower).status,'secured');
assert.equal(planGradeGoal({prelim:5,midterm:5},1,lower).status,'unreachable');
assert.equal(planGradeGoal({prelim:1,midterm:1,endterm:1},3,lower).status,'achieved');
const lockedBoth=planGradeGoal({prelim:85},90,scale,{locked:['midterm','endterm'],planned:{midterm:95,endterm:90}});
assert.equal(lockedBoth.scenario.predicted,90);verify(lockedBoth,{prelim:85},90);
assert.equal(planGradeGoal({prelim:85},90,scale,{locked:['midterm'],planned:{midterm:101}}).scenario.feasible,false);
assert.equal(planGradeGoal({},4.5,{minimum:1.5,maximum:4.5,direction:'higher'},{wholeNumbers:true}).status,'unreachable');
assert.equal(planGradeGoal({},1.5,{minimum:1.5,maximum:4.5,direction:'lower'},{wholeNumbers:true}).status,'unreachable');
// Every missing-grade order and a deterministic spread of scales, targets and locks.
let seed=1751;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
for(const selectedScale of [scale,lower,{minimum:0,maximum:10,direction:'higher'},{minimum:1.1,maximum:4.9,direction:'lower'}]) {
  for(let mask=0;mask<8;mask++) for(let run=0;run<60;run++) {
    const grades={}; const terms=['prelim','midterm','endterm'];
    const sample=()=>Number((selectedScale.minimum+random()*(selectedScale.maximum-selectedScale.minimum)).toFixed(2));
    terms.forEach((term,i)=>{if(mask&(1<<i)) grades[term]=sample();});
    const target=sample();
    const options=run%3===0?{wholeNumbers:true}:run%3===1?{driver:'midterm',planned:{midterm:sample()}}:{locked:['endterm'],planned:{endterm:sample()}};
    const result=planGradeGoal(grades,target,selectedScale,options);
    verify(result,grades,target,selectedScale);
    assert.deepEqual(Object.fromEntries(Object.entries(result.actual).filter(([,v])=>v!==null)),grades);
  }
}
console.log('Smart goal engine passed: required examples, balanced and focused plans, locks, actual-grade preservation, safe rounding, invalid inputs, all term orders, both scale directions, and 1,920 generated scenarios.');

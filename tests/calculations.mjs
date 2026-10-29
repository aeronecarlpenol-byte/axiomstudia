import assert from 'node:assert/strict';
import { averageGrade, gradeValue, requiredEndterm, GRADE_WEIGHTS } from '../js/grading.js';
const scale = { minimum: 0, maximum: 100, direction: 'higher' };
assert.equal(averageGrade({ prelim:85, midterm:90, endterm:95 }, scale, true), 90.5);
for (const [p,m,t,want] of [[85,90,90,93.75],[80,80,85,92.5],[90,90,90,90],[70,75,80,91.25],[95,95,90,82.5],[85.5,90.25,90.1,93.4375]]) {
  const actual = requiredEndterm(p,m,t,scale);
  assert.equal(actual.status,'required');
  assert.ok(Math.abs(actual.value-want)<1e-9);
}
assert.equal(requiredEndterm(0,0,100,scale).status,'unreachable');
assert.equal(requiredEndterm(100,100,50,scale).status,'secured');
assert.equal(requiredEndterm(0,0,40,scale).value,100);
assert.equal(requiredEndterm(100,100,60,scale).status,'secured');
for (const invalid of [null,undefined,'',' ',NaN,Infinity,-1,101,'85oops',true]) {
  assert.equal(gradeValue(invalid,scale),null);
  assert.equal(requiredEndterm(invalid,80,85,scale).status,'missing');
}
assert.equal(averageGrade({prelim:80},scale,true),null);
assert.equal(averageGrade({prelim:80},scale),80);
assert.equal(averageGrade({},scale),null);
const lower={minimum:1,maximum:5,direction:'lower'};
assert.equal(requiredEndterm(2,4,3,lower).value,3);
assert.equal(requiredEndterm(5,5,1,lower).status,'unreachable');
assert.equal(requiredEndterm(1,1,5,lower).status,'secured');
assert.equal(averageGrade({prelim:2,midterm:3,endterm:4},lower,true),3.1);
assert.deepEqual(GRADE_WEIGHTS,{prelim:30,midterm:30,endterm:40});
console.log('Grade formula, targets, decimals, boundaries, missing values, and alternate scales passed.');

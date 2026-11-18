import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bootApp} from './helpers/boot.mjs';
test('calendar/list switching preserves month, selected date and editable workout records', async()=>{
 const w=await bootApp();await w.addMovement('Mode test squat','Squat');w.applyFieldValue('step','weight',60);await w.saveSet();
 w.document.getElementById('tabCalendarBtn').click();
 const selected=w.document.querySelector('.cal-cell.selected').dataset.date;
 const month=w.document.getElementById('calMonthLabel').textContent;
 w.document.querySelector('[data-action="cal-toggle-view"]').click();
 assert.ok(w.document.querySelector('.history-month-list').textContent.includes('Mode test squat'));
 assert.ok(w.document.querySelector('.history-month-list [data-action="edit-entry"]'));
 assert.equal(w.document.getElementById('calMonthLabel').textContent,month);
 w.document.querySelector('[data-action="cal-prev"]').click();
 assert.notEqual(w.document.getElementById('calMonthLabel').textContent,month);
 w.document.querySelector('[data-action="cal-next"]').click();
 w.document.querySelector('[data-action="cal-toggle-view"]').click();
 assert.equal(w.document.getElementById('calMonthLabel').textContent,month);
 assert.equal(w.document.querySelector('.cal-cell.selected').dataset.date,selected);
 assert.equal(w.document.getElementById('calDetail').hidden,false);
});

// F-026 (axe label-content-name-mismatch, serious): the visible word must be inside the accessible name, at its
// start. The name is the button's text, since it has no aria-label: the visible word plus a visually hidden part.
test('F-026: the calendar/list toggle\'s accessible name starts with its visible label', async () => {
  const w = await bootApp();
  w.document.getElementById('tabCalendarBtn').click();
  for (const [visible, rest] of [['רשימה', 'הצגת רשימת אימונים'], ['לוח', 'הצגת לוח שנה']]) {
    const b = w.document.querySelector('[data-action="cal-toggle-view"]');
    assert.equal(b.getAttribute('aria-label'), null, 'no aria-label to drift from the text');
    assert.equal(b.getAttribute('aria-pressed'), null, 'no pressed state that contradicts the label');
    const hidden = b.querySelector('.sr-only');
    const shown = [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    assert.equal(shown, visible, 'the visible text');
    assert.equal(hidden.textContent.trim(), '— ' + rest, 'the hidden description');
    assert.ok(b.textContent.trim().startsWith(visible), 'the accessible name starts with the visible label');
    b.click();
  }
});

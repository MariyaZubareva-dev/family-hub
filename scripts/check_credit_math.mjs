import assert from 'node:assert/strict';

const principal = 3835200;
const annualRate = 21.4;
const payments = (m) => m <= 120 ? 69706.07 : m <= 240 ? 60202.24 : m <= 359 ? 57734.02 : 70829.31;
const prepayments = new Map([
  ['2026-06-04', 1000.52],
  ['2026-07-04', 1162.96],
  ['2026-08-04', 1000.00],
]);
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const leap = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const parse = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const addMonths = (s, months) => {
  const d = parse(s); const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last)); return iso(target);
};
const dayInterest = (balance, rate, from, to) => {
  let cursor = parse(from), value = 0, end = parse(to);
  while (cursor < end) {
    cursor = new Date(cursor.getTime() + 86400000);
    value += balance * (rate / 100) / (leap(cursor.getUTCFullYear()) ? 366 : 365);
  }
  return value;
};

function run(withPrepayments) {
  let balance = principal; let anchor = '2026-05-04'; let payoff = null; let currentBalance = principal; let accruedNow = 0;
  const out = [];
  for (let month = 1; month <= 360; month++) {
    const due = addMonths('2026-06-04', month - 1);
    const nextDue = addMonths('2026-06-04', month);
    if (withPrepayments && balance <= 0.005) break;
    const interest = r2(dayInterest(balance, annualRate, anchor, due));
    const payment = payments(month);
    const actualPayment = r2(Math.min(payment, balance + interest));
    const body = r2(Math.min(balance, Math.max(0, actualPayment - interest)));
    balance = r2(balance - body);
    let pp = 0;
    if (withPrepayments && prepayments.has(due)) { pp = prepayments.get(due); balance = r2(balance - pp); }
    out.push({ month, due, interest, body, payment: actualPayment, pp, balance });
    anchor = due;
    if (balance <= 0.005) { payoff = due; break; }
    if (due === '2026-08-04') {
      currentBalance = balance;
      accruedNow = r2(dayInterest(balance, annualRate, due, '2026-09-01'));
      // No mid-period prepayment in this specific contract history.
    }
  }
  return {out, balance, payoff, currentBalance, accruedNow};
}

const base = run(false);
assert.equal(base.out[0].interest, 69706.07);
assert.equal(base.out[1].interest, 67457.49);
assert.equal(base.out[2].interest, 69665.20);
assert.equal(base.out.at(-1).due, '2056-05-04');
assert.ok(base.balance < 10, `contract-only residual should be rounding-sized, got ${base.balance}`);

const actual = run(true);
assert.equal(actual.out[0].balance, 3834199.48);
assert.equal(actual.out[1].body, 2266.18);
assert.equal(actual.out[1].balance, 3830770.34);
assert.equal(actual.out[2].interest, 69625.56);
assert.equal(actual.out[2].body, 80.51);
assert.equal(actual.out[2].balance, 3829689.83);
assert.equal(actual.payoff, '2054-05-04');
assert.equal(actual.currentBalance, 3829689.83);
assert.ok(Math.abs(actual.accruedNow - 62869.87) < 0.01);

console.log('Credit contract checks passed.');
console.log(JSON.stringify({
  contractEnd: base.out.at(-1)?.due,
  projectedEndWithHistoricalPrepayments: actual.payoff,
  balanceAfter2026_08_04Prepayment: actual.currentBalance,
  accruedInterestOn2026_09_01: actual.accruedNow,
}, null, 2));

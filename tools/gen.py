#!/usr/bin/env python3
"""Ustatahir sakin sayfası veri üreticisi.

Kullanım: python3 gen.py <db_export_dir> <out data.json>
<db_export_dir> içinde ArtifactData out_dir dışa aktarımı beklenir:
  settings/main.json, units/*.json, ledger/*.json, exp/*.json
Kişisel daire verisi, dairenin gizli link anahtarıyla (token) AES-GCM ile şifrelenir;
yayımlanan dosyada isim, telefon veya anahtar bulunmaz.
"""
import json, os, sys, glob, hashlib, base64, math, datetime
from zoneinfo import ZoneInfo
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def load(path):
    d = json.load(open(path, encoding='utf-8'))
    return d['data'] if isinstance(d, dict) and 'data' in d and isinstance(d['data'], dict) else d

def main(src, out):
    today = datetime.datetime.now(ZoneInfo('Europe/Istanbul')).date()
    s = load(os.path.join(src, 'settings', 'main.json'))
    year = int(s.get('currentYear') or today.year)
    yc = (s.get('years') or {}).get(str(year)) or {}
    base_aidat = float(yc.get('aidat') or 0)
    due_day = int(s.get('dueDay') or 10)
    fee_rate = s.get('feeRate'); fee_rate = 5.0 if fee_rate in (None, '') else float(fee_rate)

    if today < datetime.date(year, 1, due_day): md = 0
    elif today.year > year: md = 12
    else: md = max(0, min(12, today.month - (1 if today.day < due_day else 0)))

    units = {os.path.basename(f)[:-5]: load(f) for f in glob.glob(os.path.join(src, 'units', '*.json'))}
    ledgers = {}
    for f in glob.glob(os.path.join(src, 'ledger', '*.json')):
        d = load(f)
        if int(d.get('year', 0)) == year: ledgers[d['unit']] = d.get('items') or []
    exps = []
    for f in glob.glob(os.path.join(src, 'exp', '*.json')):
        d = load(f)
        if int(d.get('year', 0)) == year: exps += d.get('items') or []

    pub = {'site': s.get('siteName') or 'Ustatahir Konutları', 'year': year, 'updated': today.isoformat(),
           'aidat': base_aidat, 'dueDay': due_day, 'md': md, 'feeRate': fee_rate,
           'iban': s.get('iban') or '', 'ibanName': s.get('ibanName') or '',
           'announcements': [a for a in (s.get('announcements') or []) if a.get('public', True)][-12:]}
    n = paid_t = due_t = over_t = 0; good = 0; month_paid = [0]*12
    enc = {}
    for kod, u in sorted(units.items()):
        if u.get('active') is False: continue
        aidat = float(u['aidat']) if u.get('aidat') not in (None, '') else base_aidat
        its = ledgers.get(kod, [])
        paid = sum(i['amount'] for i in its if i.get('type') == 'odeme')
        extra = sum(i['amount'] for i in its if i.get('type') == 'borc') - sum(i['amount'] for i in its if i.get('type') == 'indirim')
        due = aidat*md + extra; overdue = max(0.0, round(due - paid, 2)); net = max(0.0, paid - extra)
        ms = []
        for m in range(12):
            if aidat <= 0: ms.append('f')
            elif net >= (m+1)*aidat - 1e-3: ms.append('p')
            elif net > m*aidat + 1e-3: ms.append('k')
            else: ms.append('l' if m < md else 'f')
        # gecikme tazminatı (programla aynı)
        fee = 0.0
        if fee_rate > 0 and aidat > 0:
            last = max([i['until'] for i in its if i.get('kind') == 'tazminat' and i.get('until')] or [''])
            lu = datetime.date.fromisoformat(last) if last else None
            for m in range(md):
                unpaid = min(aidat, max(0.0, (m+1)*aidat - net))
                if unpaid <= 0: continue
                start = datetime.date(year, m+1, due_day)
                if lu and lu > start: start = lu
                days = (today - start).days
                if days > 0: fee += unpaid * fee_rate / 100 * days / 30
        fee = round(fee, 2)
        behind = math.ceil(overdue/aidat - 1e-4) if aidat > 0 else 0
        n += 1; paid_t += paid; due_t += max(0, due); over_t += overdue; good += overdue <= 0
        for i, x in enumerate(ms):
            if x == 'p': month_paid[i] += 1
        tok = u.get('token')
        if tok:
            rec = {'kod': kod, 'blok': u.get('blok'), 'no': u.get('no'), 'aidat': aidat, 'paid': paid, 'extra': extra,
                   'annual': aidat*12 + extra, 'due': due, 'overdue': overdue, 'behind': behind, 'ms': ms, 'fee': fee,
                   'items': sorted([{'date': i.get('date') or '', 'desc': i.get('desc') or '', 'type': i.get('type'),
                                     'amount': i['amount'], 'method': i.get('method') or ''} for i in its],
                                   key=lambda x: (x['date'] == '', x['date']))}
            key = hashlib.sha256(('ustatahir-v1:' + tok).encode()).digest()
            iv = os.urandom(12)
            ct = AESGCM(key).encrypt(iv, json.dumps(rec, ensure_ascii=False).encode(), None)
            enc[hashlib.sha256(('id:' + tok).encode()).hexdigest()[:24]] = base64.b64encode(iv + ct).decode()
    by_cat = {}
    for e in exps:
        if e.get('category') == 'Borç Geri Ödemesi': continue
        by_cat[e.get('category') or 'Diğer'] = round(by_cat.get(e.get('category') or 'Diğer', 0) + e['amount'], 2)
    by_month = [0.0]*12
    for e in exps:
        if e.get('category') == 'Borç Geri Ödemesi' or not e.get('date'): continue
        by_month[int(e['date'][5:7]) - 1] += e['amount']
    pub.update({'n': n, 'paid': round(paid_t, 2), 'due': round(due_t, 2), 'overdue': round(over_t, 2), 'good': good,
                'debtors': n - good, 'monthPaid': month_paid, 'expByCat': by_cat, 'expByMonth': [round(x, 2) for x in by_month],
                'expTotal': round(sum(by_cat.values()), 2)})
    json.dump({'v': 1, 'pub': pub, 'units': enc}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{year}: {n} daire, tahsilat {paid_t:.2f}, gecikmiş {over_t:.2f}, gider {pub["expTotal"]:.2f}, şifreli {len(enc)}')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

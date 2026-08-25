// Unit-Tests fuer die Meta Conversions API. Ausfuehren: node admin/meta-capi.test.js
//
// Getestet wird alles ausser dem eigentlichen HTTP-Aufruf: Normalisierung,
// Hashing und die Regeln, wann ueberhaupt gesendet werden darf. Die
// Normalisierung ist der heikle Teil — weicht sie von Metas Vorgabe ab,
// stimmen die Hashes nicht ueberein und die Zuordnung geht still verloren.
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const capi = require('./meta-capi');
const { normEmail, normPhone, normName, splitName, buildUserData, sha256 } = capi._internals;

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('  ok -', name); }

const hash = v => crypto.createHash('sha256').update(v, 'utf8').digest('hex');

// --- E-Mail ---
t('E-Mail wird getrimmt und kleingeschrieben', () => {
  assert.strictEqual(normEmail('  Kiran@Example.COM '), 'kiran@example.com');
});

t('E-Mail ohne @ faellt raus', () => {
  assert.strictEqual(normEmail('kein-at-zeichen'), '');
});

// --- Telefon ---
t('internationale Schreibweise mit + verliert Plus und Leerzeichen', () => {
  assert.strictEqual(normPhone('+43 660 482 2420'), '436604822420');
});

t('00-Praefix wird zur Laendervorwahl', () => {
  assert.strictEqual(normPhone('0043 660 4822420'), '436604822420');
});

t('nationale Schreibweise bekommt 43 vorangestellt', () => {
  assert.strictEqual(normPhone('0660 4822420'), '436604822420');
});

t('drei Schreibweisen derselben Nummer ergeben denselben Hash', () => {
  const a = normPhone('+43 660 4822420');
  const b = normPhone('0043-660-4822420');
  const c = normPhone('0660/4822420');
  assert.strictEqual(a, b);
  assert.strictEqual(b, c);
});

t('deutsche Nummer mit + bleibt deutsch, wird nicht nach AT verbogen', () => {
  assert.strictEqual(normPhone('+49 170 1234567'), '491701234567');
});

t('zu kurze und zu lange Nummern werden verworfen', () => {
  assert.strictEqual(normPhone('12345'), '');
  assert.strictEqual(normPhone('+1234567890123456789'), '');
});

t('leeres Telefonfeld ergibt leeren String, nicht "43"', () => {
  assert.strictEqual(normPhone(''), '');
  assert.strictEqual(normPhone(undefined), '');
});

// --- Namen ---
t('Name wird kleingeschrieben, Umlaute bleiben erhalten', () => {
  assert.strictEqual(normName(' Müller '), 'müller');
});

t('Bindestriche und Leerzeichen fallen aus dem Namen', () => {
  assert.strictEqual(normName('Anna-Maria'), 'annamaria');
  assert.strictEqual(normName("O'Brien"), 'obrien');
});

t('einzelnes Wort ist Vorname, Nachname bleibt leer', () => {
  assert.deepStrictEqual(splitName('Kiran'), { first: 'Kiran', last: '' });
});

t('mehrteiliger Nachname bleibt zusammen', () => {
  assert.deepStrictEqual(splitName('Kiran Kothakuzhakal Jr'),
    { first: 'Kiran', last: 'Kothakuzhakal Jr' });
});

t('leeres Namensfeld kippt nicht um', () => {
  assert.deepStrictEqual(splitName('   '), { first: '', last: '' });
});

// --- Cookies ---
t('_fbp wird aus einem Cookie-Header mit mehreren Werten gelesen', () => {
  const header = 'ww-x=1; _fbp=fb.1.1700000000000.123456; _fbc=fb.1.1700000000000.abc';
  assert.strictEqual(capi.readCookie(header, '_fbp'), 'fb.1.1700000000000.123456');
  assert.strictEqual(capi.readCookie(header, '_fbc'), 'fb.1.1700000000000.abc');
});

t('ein Cookie-Name, der auf _fbp endet, wird nicht verwechselt', () => {
  assert.strictEqual(capi.readCookie('nicht_fbp=xxx', '_fbp'), '');
});

t('fehlender Cookie-Header ergibt leeren String', () => {
  assert.strictEqual(capi.readCookie(undefined, '_fbp'), '');
});

// --- IP ---
t('IPv4-in-IPv6 wird auf die echte Adresse zurueckgefuehrt', () => {
  assert.strictEqual(capi.normIp('::ffff:203.0.113.7'), '203.0.113.7');
});

t('echte IPv6 bleibt unangetastet', () => {
  assert.strictEqual(capi.normIp('2001:db8::1'), '2001:db8::1');
});

// --- user_data ---
t('user_data enthaelt gehashte Werte, niemals Klartext', () => {
  const ud = buildUserData(
    { name: 'Kiran Kothakuzhakal', email: 'Kiran@Example.com', phone: '0660 4822420' },
    { ip: '203.0.113.7', userAgent: 'Mozilla/5.0', fbp: 'fb.1.1.2', fbc: '' }
  );
  assert.deepStrictEqual(ud.em, [hash('kiran@example.com')]);
  assert.deepStrictEqual(ud.ph, [hash('436604822420')]);
  assert.deepStrictEqual(ud.fn, [hash('kiran')]);
  assert.deepStrictEqual(ud.ln, [hash('kothakuzhakal')]);
  const flat = JSON.stringify(ud).toLowerCase();
  assert.ok(!flat.includes('kiran@example.com'), 'E-Mail darf nicht im Klartext stehen');
  assert.ok(!flat.includes('4822420'), 'Telefonnummer darf nicht im Klartext stehen');
  assert.ok(!flat.includes('kothakuzhakal'), 'Name darf nicht im Klartext stehen');
});

t('IP und User-Agent gehen ungehasht — so verlangt Meta es', () => {
  const ud = buildUserData({}, { ip: '203.0.113.7', userAgent: 'Mozilla/5.0' });
  assert.strictEqual(ud.client_ip_address, '203.0.113.7');
  assert.strictEqual(ud.client_user_agent, 'Mozilla/5.0');
});

t('fehlende Felder erzeugen keine leeren Hashes', () => {
  const ud = buildUserData({ name: '', email: '', phone: '' }, {});
  assert.ok(!('em' in ud) && !('ph' in ud) && !('fn' in ud) && !('ln' in ud));
  assert.ok(!('fbp' in ud) && !('fbc' in ud));
});

t('sha256 liefert Hex in Kleinschreibung', () => {
  assert.match(sha256('test'), /^[0-9a-f]{64}$/);
});

// --- Startmeldung ---
// Ohne sie laesst sich ein fehlendes Event nicht von einem fehlenden Token
// unterscheiden: beides sieht im Log gleich aus, naemlich nach nichts.
t('Startmeldung nennt den Zustand eindeutig', () => {
  const line = capi.startupSummary();
  if (process.env.META_CAPI_TOKEN) {
    assert.ok(line.includes('aktiv'), line);
    assert.ok(line.includes('1069216136085670'), 'Pixel-ID fehlt');
  } else {
    assert.ok(line.includes('DEAKTIVIERT'), line);
    assert.ok(line.includes('META_CAPI_TOKEN'), 'der fehlende Schluessel wird nicht benannt');
  }
});

t('Startmeldung verraet den Token nicht', () => {
  const line = capi.startupSummary();
  if (process.env.META_CAPI_TOKEN) {
    assert.ok(!line.includes(process.env.META_CAPI_TOKEN), 'Token darf nicht im Log stehen');
  }
});

t('Testmodus wird in der Startmeldung als solcher benannt', () => {
  const line = capi.startupSummary();
  assert.strictEqual(line.includes('TESTMODUS'), Boolean(process.env.META_CAPI_TOKEN && process.env.META_TEST_EVENT_CODE));
});

t('jede Event-ID ist eindeutig', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(capi.newEventId());
  assert.strictEqual(ids.size, 500);
});

// --- Sendelogik ---
// sendLead() darf ohne Einwilligung unter keinen Umstaenden Daten uebertragen.
// Deshalb wird fetch fuer diese Tests durch eine Falle ersetzt: kommt es
// trotzdem zum Aufruf, faellt der Test um, statt still durchzulaufen.
async function ta(name, fn) { await fn(); passed++; console.log('  ok -', name); }

const lead = { name: 'Test Paar', email: 'test@example.com', phone: '+436601234567' };
const fullCtx = { consent: true, eventId: 'abc123', ip: '203.0.113.7', userAgent: 'UA' };

async function withFetchTrap(fn) {
  const realFetch = global.fetch;
  let called = false;
  global.fetch = () => { called = true; throw new Error('fetch wurde aufgerufen'); };
  try {
    const result = await fn();
    return { result, called };
  } finally {
    global.fetch = realFetch;
  }
}

(async () => {
  await ta('ohne Einwilligung wird nichts uebertragen', async () => {
    const { result, called } = await withFetchTrap(() =>
      capi.sendLead(lead, { ...fullCtx, consent: false }));
    assert.strictEqual(called, false, 'ohne Einwilligung darf kein Request rausgehen');
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.reason, 'no-consent');
  });

  await ta('Einwilligung wird vor der Konfiguration geprueft', async () => {
    // Wichtig fuer die Reihenfolge in sendLead(): auch mit gueltigem Token
    // bleibt "keine Einwilligung" der Grund, aus dem nichts rausgeht.
    const { result } = await withFetchTrap(() =>
      capi.sendLead(lead, { ...fullCtx, consent: false, eventId: '' }));
    assert.strictEqual(result.reason, 'no-consent');
  });

  await ta('ohne Identifikationsmerkmal wird gar nicht erst gefragt', async () => {
    const { result, called } = await withFetchTrap(() =>
      capi.sendLead({}, { consent: true, eventId: 'abc123' }));
    assert.strictEqual(called, false);
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.reason, process.env.META_CAPI_TOKEN ? 'no-identifier' : 'not-configured');
  });

  await ta('ohne Token ist das Modul still deaktiviert', async () => {
    assert.strictEqual(capi.isConfigured(), Boolean(process.env.META_CAPI_TOKEN));
    if (!process.env.META_CAPI_TOKEN) {
      const { result, called } = await withFetchTrap(() => capi.sendLead(lead, fullCtx));
      assert.strictEqual(called, false);
      assert.strictEqual(result.reason, 'not-configured');
    }
  });

  // Der abgeschickte Request-Body laesst sich gegen Meta nicht proben, ohne
  // echte Events zu erzeugen. Diese Tests laufen deshalb mit einem Dummy-Token
  // gegen ein abgefangenes fetch — aufgerufen ueber:
  //   META_CAPI_TOKEN=dummy node admin/meta-capi.test.js
  if (process.env.META_CAPI_TOKEN) {
    let captured = null;
    const realFetch = global.fetch;
    global.fetch = (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) };
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ events_received: 1 }) });
    };

    try {
      const res = await capi.sendLead(
        { name: 'Anna Beispiel', email: 'anna@example.com', phone: '0660 1234567',
          eventType: 'wedding', interesse: ['foto', 'film'],
          message: 'GEHEIM', budget: '5000', dates: ['2027-06-12'] },
        { ...fullCtx, sourceUrl: 'https://www.walkingweddings.com/contact.html',
          fbp: 'fb.1.1700000000000.99' }
      );

      await ta('Aufruf geht an die Events-Route des richtigen Pixels', () => {
        assert.strictEqual(res.sent, true);
        assert.ok(captured.url.startsWith('https://graph.facebook.com/'));
        assert.ok(captured.url.includes('/events?access_token='));
      });

      await ta('Event traegt Name, Zeit, ID und action_source', () => {
        const ev = captured.body.data[0];
        assert.strictEqual(ev.event_name, 'Lead');
        assert.strictEqual(ev.event_id, 'abc123');
        assert.strictEqual(ev.action_source, 'website');
        assert.strictEqual(ev.event_source_url, 'https://www.walkingweddings.com/contact.html');
        // Sekunden, nicht Millisekunden — Meta verwirft sonst als "zu alt".
        assert.ok(Math.abs(ev.event_time - Math.floor(Date.now() / 1000)) < 5);
      });

      await ta('Freitext des Paares wird NICHT an Meta uebertragen', () => {
        const flat = JSON.stringify(captured.body);
        assert.ok(!flat.includes('GEHEIM'), 'Nachricht darf nicht mitgehen');
        assert.ok(!flat.includes('5000'), 'Budget darf nicht mitgehen');
        assert.ok(!flat.includes('2027-06-12'), 'Wunschtermin darf nicht mitgehen');
        assert.ok(!flat.includes('anna@example.com'), 'E-Mail nur gehasht');
        assert.ok(!flat.includes('Anna'), 'Name nur gehasht');
      });

      await ta('fbp wird durchgereicht, Hashes stehen als Array', () => {
        const ud = captured.body.data[0].user_data;
        assert.strictEqual(ud.fbp, 'fb.1.1700000000000.99');
        assert.ok(Array.isArray(ud.em) && /^[0-9a-f]{64}$/.test(ud.em[0]));
      });

      await ta('ohne Testcode kein test_event_code im Body', () => {
        assert.strictEqual('test_event_code' in captured.body,
          Boolean(process.env.META_TEST_EVENT_CODE));
      });

      await ta('ein Fehler von Meta wirft nicht, sondern wird gemeldet', async () => {
        global.fetch = () => Promise.resolve({
          ok: false, status: 400,
          json: () => Promise.resolve({ error: { message: 'Invalid parameter' } }),
        });
        const bad = await capi.sendLead(lead, fullCtx);
        assert.strictEqual(bad.sent, false);
        assert.strictEqual(bad.reason, 'api-error');
        assert.strictEqual(bad.error, 'Invalid parameter');
        // Feldnamen ja, Werte nein.
        assert.ok(bad.sentFields.includes('em'));
        assert.ok(!bad.sentFields.includes('@'));
      });

      // "Invalid parameter" ist Metas Sammelmeldung und diagnostiziert nichts.
      // Die Begruendung steht in den Zusatzfeldern — die muessen ins Log.
      await ta('Metas Begruendung landet vollstaendig im Fehlertext', async () => {
        global.fetch = () => Promise.resolve({
          ok: false, status: 400,
          json: () => Promise.resolve({ error: {
            message: 'Invalid parameter',
            type: 'OAuthException',
            code: 100,
            error_subcode: 2804003,
            error_user_title: 'Ungueltiger Testereignis-Code',
            error_user_msg: 'Der Code TEST99999 gehoert zu keinem Datensatz.',
            fbtrace_id: 'AbCdEf123',
          } }),
        });
        const bad = await capi.sendLead(lead, fullCtx);
        assert.ok(bad.error.includes('Invalid parameter'));
        assert.ok(bad.error.includes('Ungueltiger Testereignis-Code'));
        assert.ok(bad.error.includes('TEST99999'), 'die konkrete Begruendung fehlt');
        assert.ok(bad.error.includes('code 100'));
        assert.ok(bad.error.includes('subcode 2804003'));
        assert.ok(bad.error.includes('AbCdEf123'), 'fbtrace_id fehlt fuer Metas Support');
      });

      await ta('error_data als JSON-String wird aufgeloest, nicht roh angehaengt', async () => {
        global.fetch = () => Promise.resolve({
          ok: false, status: 400,
          json: () => Promise.resolve({ error: {
            message: 'Invalid parameter',
            error_data: '{"messages":["user_data.ph muss gehasht sein"]}',
          } }),
        });
        const bad = await capi.sendLead(lead, fullCtx);
        assert.ok(bad.error.includes('user_data.ph'), 'das beanstandete Feld fehlt');
      });

      await ta('eine Antwort ohne error-Objekt faellt auf den Status zurueck', async () => {
        global.fetch = () => Promise.resolve({
          ok: false, status: 503, json: () => Promise.resolve({}),
        });
        const bad = await capi.sendLead(lead, fullCtx);
        assert.strictEqual(bad.error, 'HTTP 503');
      });

      await ta('ein Netzwerkausfall wirft nicht', async () => {
        global.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
        const bad = await capi.sendLead(lead, fullCtx);
        assert.strictEqual(bad.sent, false);
        assert.strictEqual(bad.reason, 'network-error');
      });
    } finally {
      global.fetch = realFetch;
    }
  }

  console.log(`\n${passed} Tests bestanden.`);
})().catch(err => {
  console.error('\n  FEHLGESCHLAGEN:', err.message);
  process.exit(1);
});

// Clasificación de movimientos del extracto en rubros del informe.
//
// Orden de decisión (lo manual/excluido lo respeta el servicio, no llega acá):
//   1. Reglas del consorcio (CUIT, texto, concepto, sentido, monto).
//   2. Código de concepto conocido (cobranzas → Ingresos, comisiones/impuestos → Gastos bancarios).
//   3. Si nada aplica → PENDIENTE, con el motivo explicado.
const { ConsorcioError } = require('./errors');
const { CONCEPTS, TRANSFER_CODES } = require('./conceptCodes');
const { formatAmount } = require('./money');

const STATUS = {
  AUTO: 'AUTO',
  REGLA: 'REGLA',
  MANUAL: 'MANUAL',
  EXCLUIDO: 'EXCLUIDO',
  PENDIENTE: 'PENDIENTE',
};

function normalize(text) {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function hasCondition(rule) {
  return Boolean(rule.matchCuit || rule.matchText || rule.matchConcept);
}

function ruleMatches(rule, mv) {
  if (!rule.isActive || !hasCondition(rule)) return false;
  if (rule.matchCuit && rule.matchCuit !== mv.cuit) return false;
  if (rule.matchText && !normalize(mv.description).includes(normalize(rule.matchText))) return false;
  if (rule.matchConcept && rule.matchConcept !== mv.conceptCode) return false;
  if (rule.direction === 'CREDITO' && mv.amountCents < 0) return false;
  if (rule.direction === 'DEBITO' && mv.amountCents > 0) return false;
  if (rule.matchAmountCents != null && rule.matchAmountCents !== Math.abs(mv.amountCents)) return false;
  return true;
}

function rubroName(rubrosById, rubroId) {
  const r = rubrosById.get(rubroId);
  return r ? `${String(r.number).padStart(2, '0')} ${r.name}` : '(rubro borrado)';
}

// Explica una regla en castellano para la pantalla de configuración.
function describeRule(rule, rubros) {
  const rubrosById = new Map(rubros.map((r) => [r.id, r]));
  const conds = [];
  if (rule.matchCuit) conds.push(`el CUIT es ${rule.matchCuit}`);
  if (rule.matchText) conds.push(`la descripción contiene "${rule.matchText}"`);
  if (rule.matchConcept) conds.push(`el código de concepto es ${rule.matchConcept}`);
  if (rule.direction === 'CREDITO') conds.push('es un crédito (entra plata)');
  if (rule.direction === 'DEBITO') conds.push('es un débito (sale plata)');
  if (rule.matchAmountCents != null) conds.push(`el importe es ${formatAmount(rule.matchAmountCents)}`);
  const target = `${rubroName(rubrosById, rule.rubroId)} «${rule.itemLabel}»`;
  const action = rule.alwaysAsk ? `sugerir ${target}, pero preguntar siempre` : `va a ${target}`;
  return `Si ${conds.join(' y ')} → ${action}${rule.isActive ? '' : ' (desactivada)'}`;
}

function targetKey(t) {
  return `${t.rubroId}|${normalize(t.itemLabel)}`;
}

function uniqueTargets(rules) {
  const map = new Map();
  for (const r of rules) {
    const key = targetKey(r);
    if (!map.has(key)) map.set(key, { rubroId: r.rubroId, itemLabel: r.itemLabel, ruleId: r.id });
  }
  return [...map.values()];
}

function who(mv) {
  return mv.counterparty || mv.description;
}

function classifyMovement(mv, rules, rubros) {
  const rubrosById = new Map(rubros.map((r) => [r.id, r]));
  const matches = rules.filter((r) => ruleMatches(r, mv));

  if (matches.length) {
    const top = Math.max(...matches.map((r) => r.priority || 0));
    const best = matches.filter((r) => (r.priority || 0) === top);
    const targets = uniqueTargets(best);
    if (best.some((r) => r.alwaysAsk)) {
      return {
        status: STATUS.PENDIENTE, rubroId: null, itemLabel: null, ruleId: null,
        reason: `Elegí a qué corresponde: los pagos a ${who(mv)} pueden ser distintas cosas (regla "preguntar siempre").`,
        suggestions: targets,
      };
    }
    if (targets.length > 1) {
      return {
        status: STATUS.PENDIENTE, rubroId: null, itemLabel: null, ruleId: null,
        reason: `Conflicto: ${best.length} reglas con la misma prioridad mandan este movimiento a lugares distintos. Elegí uno o ajustá las prioridades.`,
        suggestions: targets,
      };
    }
    const rule = best[0];
    return {
      status: STATUS.REGLA, rubroId: rule.rubroId, itemLabel: rule.itemLabel, ruleId: rule.id,
      reason: `Por regla: ${describeRule(rule, rubros)}`,
      suggestions: [],
    };
  }

  const concept = CONCEPTS[mv.conceptCode];
  if (concept) {
    const isCreditRole = concept.role === 'INGRESOS';
    const directionOk = isCreditRole ? mv.amountCents > 0 : mv.amountCents < 0;
    const rubro = rubros.find((r) => r.role === concept.role);
    if (directionOk && rubro) {
      return {
        status: STATUS.AUTO, rubroId: rubro.id, itemLabel: rubro.defaultItemLabel, ruleId: null,
        reason: `Automático: código ${mv.conceptCode} (${concept.label}) → ${rubroName(rubrosById, rubro.id)}.`,
        suggestions: [],
      };
    }
    return {
      status: STATUS.PENDIENTE, rubroId: null, itemLabel: null, ruleId: null,
      reason: rubro
        ? `El código ${mv.conceptCode} (${concept.label}) normalmente es un ${isCreditRole ? 'crédito' : 'débito'}, pero este movimiento va al revés. Revisalo.`
        : `El código ${mv.conceptCode} (${concept.label}) va al rubro de ${isCreditRole ? 'ingresos' : 'gastos bancarios'}, pero el consorcio no tiene ningún rubro marcado para eso.`,
      suggestions: [],
    };
  }

  const transfer = TRANSFER_CODES[mv.conceptCode];
  return {
    status: STATUS.PENDIENTE, rubroId: null, itemLabel: null, ruleId: null,
    reason: transfer
      ? `${transfer} a ${who(mv)} sin regla: elegí a qué rubro va (y marcá "Recordar" si se repite todos los meses).`
      : `Código de concepto ${mv.conceptCode} desconocido ("${mv.description}"): elegí a qué rubro va.`,
    suggestions: [],
  };
}

function classifyAll(movements, rules, rubros) {
  return movements.map((mv) => ({ ...mv, ...classifyMovement(mv, rules, rubros) }));
}

// Regla para "Recordar para los próximos meses" a partir de un movimiento.
// Por CUIT si lo tiene; si no, por el nombre de la contraparte. Sin ninguno de
// los dos la regla atraparía todos los movimientos del mismo tipo.
function ruleFromMovement(mv, { rubroId, itemLabel, alwaysAsk = false }) {
  if (!mv.cuit && !mv.counterparty) {
    throw new ConsorcioError('CANNOT_REMEMBER',
      `No se puede recordar "${mv.description}": no tiene CUIT ni nombre, y una regla así agarraría todos los movimientos parecidos. Clasificalo sólo para este mes.`);
  }
  return {
    matchCuit: mv.cuit || null,
    matchText: mv.cuit ? null : mv.counterparty,
    matchConcept: null,
    direction: mv.amountCents > 0 ? 'CREDITO' : 'DEBITO',
    matchAmountCents: null,
    rubroId,
    itemLabel,
    alwaysAsk,
    priority: 0,
    isActive: true,
  };
}

function sameMatch(a, b) {
  return (a.matchCuit || null) === (b.matchCuit || null)
    && normalize(a.matchText || '') === normalize(b.matchText || '')
    && (a.matchConcept || null) === (b.matchConcept || null)
    && (a.direction || null) === (b.direction || null)
    && (a.matchAmountCents ?? null) === (b.matchAmountCents ?? null);
}

// Decide qué hacer con las reglas existentes al "Recordar" (solo se miran las
// reglas con las mismas condiciones que la nueva):
//   - "siempre" (alwaysAsk=false): queda UNA regla fija con el destino nuevo
//     (se reutiliza la que exista) y las sugerencias "preguntar" se desactivan.
//   - "preguntar" (alwaysAsk=true): el destino nuevo se suma como sugerencia y
//     las reglas fijas pasan a "preguntar" (ya no hay un único destino).
// Devuelve { create: [ruleData], update: [{ id, data }] }.
function planRemember(existingRules, newRule) {
  const same = existingRules.filter((r) => sameMatch(r, newRule));
  const sameTarget = same.find((r) => targetKey(r) === targetKey(newRule));
  const updates = new Map();
  const put = (id, data) => updates.set(id, { ...updates.get(id), ...data });
  const create = [];

  if (!newRule.alwaysAsk) {
    const keep = same.find((r) => !r.alwaysAsk) || sameTarget;
    if (keep) put(keep.id, { rubroId: newRule.rubroId, itemLabel: newRule.itemLabel, alwaysAsk: false, isActive: true });
    else create.push(newRule);
    for (const r of same) if (r !== keep && r.isActive) put(r.id, { isActive: false });
  } else {
    for (const r of same) if (!r.alwaysAsk) put(r.id, { alwaysAsk: true });
    if (sameTarget) put(sameTarget.id, { alwaysAsk: true, isActive: true });
    else create.push(newRule);
  }
  return { create, update: [...updates].map(([id, data]) => ({ id, data })) };
}

module.exports = {
  STATUS,
  normalize,
  ruleMatches,
  describeRule,
  classifyMovement,
  classifyAll,
  ruleFromMovement,
  planRemember,
};

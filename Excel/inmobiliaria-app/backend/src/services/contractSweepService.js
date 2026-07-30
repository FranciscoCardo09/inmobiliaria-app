// Contract Sweep Service
// Cierre perezoso de las renovaciones anticipadas.
//
// Al renovar un contrato ANTICIPADAMENTE (mientras todavía está vigente), el
// contrato viejo queda `active: true` + `renewedAt` para seguir operando con
// normalidad sus meses restantes: aparece en Control Mensual, se le cargan
// servicios, se cobra, se cierra el mes, se le aplica ajuste por índice y
// acumula punitorios. Nada de eso funciona con `active: false` (ver
// monthlyRecordService.canCreateRecordForContract y los filtros de
// adjustmentService/monthlyServiceService).
//
// Cuando su rango termina hay que dejarlo en el mismo estado terminal que una
// renovación post-vencimiento: `active: false` + `renewedAt` => estado RENEWED.
// Eso es lo que hace este barrido.

const prisma = require('../lib/prisma');

/**
 * Calcula la fecha de vencimiento sin depender de contractService (evita un
 * require circular con monthlyRecordService). Misma aritmética que
 * contractService.computeEndDate.
 */
const endDateOf = (c) => {
  const end = new Date(c.startDate);
  end.setMonth(end.getMonth() + c.durationMonths);
  end.setDate(end.getDate() - 1);
  return end;
};

/**
 * Desactiva los contratos ya sucedidos por una renovación anticipada cuyo rango
 * terminó. Idempotente y monótono (active: true -> false, nunca al revés).
 *
 * No toca contratos rescindidos: por decisión A-13 los rescindidos conservan
 * `active: true` de forma permanente.
 *
 * El conjunto candidato es diminuto (contratos activos CON renewedAt: solo las
 * renovaciones anticipadas todavía en curso), así que en régimen no escribe nada.
 *
 * @param {string} groupId
 * @param {object} [client=prisma]
 * @returns {Promise<number>} cantidad de contratos desactivados
 */
const sweepSupersededContracts = async (groupId, client = prisma) => {
  const candidates = await client.contract.findMany({
    where: { groupId, active: true, renewedAt: { not: null }, rescindedAt: null },
    select: { id: true, startDate: true, durationMonths: true },
  });

  if (candidates.length === 0) return 0;

  const now = new Date();
  const finishedIds = candidates.filter((c) => now > endDateOf(c)).map((c) => c.id);

  if (finishedIds.length === 0) return 0;

  await client.contract.updateMany({
    where: { id: { in: finishedIds } },
    data: { active: false },
  });

  return finishedIds.length;
};

module.exports = { sweepSupersededContracts };

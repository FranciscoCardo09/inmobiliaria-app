// Holiday Service - Business day support
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Argentine national holidays (fixed dates)
const ARGENTINE_FIXED_HOLIDAYS = [
  { month: 1, day: 1, name: 'Año Nuevo' },
  { month: 2, day: 24, name: 'Carnaval' },
  { month: 2, day: 25, name: 'Carnaval' },
  { month: 3, day: 24, name: 'Día Nacional de la Memoria' },
  { month: 4, day: 2, name: 'Día del Veterano y de los Caídos en Malvinas' },
  { month: 5, day: 1, name: 'Día del Trabajador' },
  { month: 5, day: 25, name: 'Día de la Revolución de Mayo' },
  { month: 6, day: 17, name: 'Paso a la Inmortalidad del Gral. Güemes' },
  { month: 6, day: 20, name: 'Paso a la Inmortalidad del Gral. Belgrano' },
  { month: 7, day: 9, name: 'Día de la Independencia' },
  { month: 8, day: 17, name: 'Paso a la Inmortalidad del Gral. San Martín' },
  { month: 10, day: 12, name: 'Día del Respeto a la Diversidad Cultural' },
  { month: 11, day: 20, name: 'Día de la Soberanía Nacional' },
  { month: 12, day: 8, name: 'Inmaculada Concepción de María' },
  { month: 12, day: 25, name: 'Navidad' },
];

const getHolidays = async (year) => {
  return prisma.holiday.findMany({
    where: { year: parseInt(year) },
    orderBy: { date: 'asc' },
  });
};

const addHoliday = async (date, name) => {
  const d = new Date(date);
  return prisma.holiday.create({
    data: {
      date: d,
      name,
      year: d.getFullYear(),
    },
  });
};

const removeHoliday = async (id) => {
  return prisma.holiday.delete({ where: { id } });
};

const seedHolidays = async (year) => {
  const y = parseInt(year);
  const created = [];

  for (const h of ARGENTINE_FIXED_HOLIDAYS) {
    const date = new Date(y, h.month - 1, h.day);
    try {
      const holiday = await prisma.holiday.upsert({
        where: { date },
        update: {},
        create: {
          date,
          name: h.name,
          year: y,
        },
      });
      created.push(holiday);
    } catch (e) {
      // Skip duplicates
    }
  }

  return created;
};

module.exports = {
  getHolidays,
  addHoliday,
  removeHoliday,
  seedHolidays,
};

// Holidays Controller
const ApiResponse = require('../utils/apiResponse');
const holidayService = require('../services/holidayService');

// GET /api/holidays?year=2026
const getHolidays = async (req, res, next) => {
  try {
    const { year } = req.query;
    if (!year) {
      return ApiResponse.badRequest(res, 'year es requerido');
    }
    const holidays = await holidayService.getHolidays(year);
    return ApiResponse.success(res, holidays);
  } catch (error) {
    next(error);
  }
};

// POST /api/holidays
const createHoliday = async (req, res, next) => {
  try {
    const { date, name } = req.body;
    if (!date || !name) {
      return ApiResponse.badRequest(res, 'date y name son requeridos');
    }
    const holiday = await holidayService.addHoliday(date, name);
    return ApiResponse.created(res, holiday, 'Feriado creado');
  } catch (error) {
    if (error.code === 'P2002') {
      return ApiResponse.conflict(res, 'Ya existe un feriado en esa fecha');
    }
    next(error);
  }
};

// POST /api/holidays/seed?year=2026
const seedHolidays = async (req, res, next) => {
  try {
    const { year } = req.query;
    if (!year) {
      return ApiResponse.badRequest(res, 'year es requerido');
    }
    const holidays = await holidayService.seedHolidays(year);
    return ApiResponse.success(res, holidays, `${holidays.length} feriados creados para ${year}`);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/holidays/:id
const deleteHoliday = async (req, res, next) => {
  try {
    const { id } = req.params;
    await holidayService.removeHoliday(id);
    return ApiResponse.success(res, null, 'Feriado eliminado');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getHolidays,
  createHoliday,
  seedHolidays,
  deleteHoliday,
};

const ApiResponse = require('../utils/apiResponse');
const propertyGroupService = require('../services/propertyGroupService');

const list = async (req, res, next) => {
  try {
    const groups = await propertyGroupService.list(req.params.groupId);
    return ApiResponse.success(res, groups);
  } catch (error) {
    next(error);
  }
};

const create = async (req, res, next) => {
  try {
    const { name, items } = req.body;
    if (!name || !items?.length) {
      return ApiResponse.badRequest(res, 'name e items son requeridos');
    }
    const pctSum = items.reduce((s, i) => s + i.percentage, 0);
    if (Math.abs(pctSum - 100) > 0.01) {
      return ApiResponse.badRequest(res, 'Los porcentajes deben sumar 100%');
    }
    const group = await propertyGroupService.create(req.params.groupId, name, items);
    return ApiResponse.created(res, group);
  } catch (error) {
    next(error);
  }
};

const update = async (req, res, next) => {
  try {
    const { name, items } = req.body;
    if (!name || !items?.length) {
      return ApiResponse.badRequest(res, 'name e items son requeridos');
    }
    const pctSum = items.reduce((s, i) => s + i.percentage, 0);
    if (Math.abs(pctSum - 100) > 0.01) {
      return ApiResponse.badRequest(res, 'Los porcentajes deben sumar 100%');
    }
    const group = await propertyGroupService.update(req.params.id, req.params.groupId, name, items);
    return ApiResponse.success(res, group);
  } catch (error) {
    next(error);
  }
};

const remove = async (req, res, next) => {
  try {
    await propertyGroupService.remove(req.params.id, req.params.groupId);
    return ApiResponse.success(res, null, 'Grupo eliminado');
  } catch (error) {
    next(error);
  }
};

module.exports = { list, create, update, remove };

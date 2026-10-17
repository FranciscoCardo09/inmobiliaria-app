// Controller HTTP de Consorcios: valida el body con zod, llama al servicio y
// traduce los errores de dominio (ConsorcioError) a respuestas con `code`
// estable para que la UI muestre el mensaje y actúe (p. ej. pedir "reemplazar").
const ApiResponse = require('../utils/apiResponse');
const service = require('../services/consorcio/consorcioService');
const v = require('../validators/consorcioValidators');
const { ConsorcioError } = require('../services/consorcio/errors');

function handle(fn) {
  return async (req, res, next) => {
    try {
      return await fn(req, res);
    } catch (err) {
      if (err instanceof ConsorcioError) {
        return res.status(err.status).json({
          success: false, code: err.code, message: err.message, details: err.details, timestamp: new Date().toISOString(),
        });
      }
      if (err.name === 'ZodError') {
        return ApiResponse.badRequest(res, err.errors.map((e) => e.message).join('. '),
          err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })));
      }
      return next(err);
    }
  };
}

const g = (req) => req.params.groupId;

const sendFile = (res, { buffer, fileName, contentType }) => {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.send(buffer);
};

module.exports = {
  list: handle(async (req, res) => ApiResponse.success(res, await service.listConsorcios(g(req)))),
  get: handle(async (req, res) => ApiResponse.success(res, await service.getConsorcio(g(req), req.params.id))),
  create: handle(async (req, res) => ApiResponse.created(res, await service.createConsorcio(g(req), v.consorcioCreate.parse(req.body)))),
  update: handle(async (req, res) => ApiResponse.success(res, await service.updateConsorcio(g(req), req.params.id, v.consorcioUpdate.parse(req.body)))),
  remove: handle(async (req, res) => {
    await service.deleteConsorcio(g(req), req.params.id);
    return ApiResponse.success(res, null, 'Consorcio eliminado');
  }),

  createRubro: handle(async (req, res) => ApiResponse.created(res, await service.createRubro(g(req), req.params.id, v.rubroCreate.parse(req.body)))),
  updateRubro: handle(async (req, res) => ApiResponse.success(res, await service.updateRubro(g(req), req.params.id, req.params.rubroId, v.rubroUpdate.parse(req.body)))),
  removeRubro: handle(async (req, res) => {
    await service.deleteRubro(g(req), req.params.id, req.params.rubroId);
    return ApiResponse.success(res, null, 'Rubro eliminado');
  }),

  createRegla: handle(async (req, res) => ApiResponse.created(res, await service.createRegla(g(req), req.params.id, v.reglaCreate.parse(req.body)))),
  updateRegla: handle(async (req, res) => ApiResponse.success(res, await service.updateRegla(g(req), req.params.id, req.params.reglaId, v.reglaUpdate.parse(req.body)))),
  removeRegla: handle(async (req, res) => {
    await service.deleteRegla(g(req), req.params.id, req.params.reglaId);
    return ApiResponse.success(res, null, 'Regla eliminada');
  }),

  listRendiciones: handle(async (req, res) => ApiResponse.success(res, await service.listRendiciones(g(req), req.params.id))),
  upload: handle(async (req, res) => ApiResponse.created(res, await service.uploadStatement(g(req), req.params.id, v.upload.parse(req.body)))),

  getRendicion: handle(async (req, res) => ApiResponse.success(res, await service.getRendicion(g(req), req.params.rid))),
  classify: handle(async (req, res) => ApiResponse.success(res, await service.classifyMovements(g(req), req.params.rid, v.classify.parse(req.body).items))),
  reapply: handle(async (req, res) => ApiResponse.success(res, await service.reapplyRules(g(req), req.params.rid))),
  createAjuste: handle(async (req, res) => ApiResponse.created(res, await service.createAjuste(g(req), req.params.rid, v.ajusteCreate.parse(req.body)))),
  updateAjuste: handle(async (req, res) => ApiResponse.success(res, await service.updateAjuste(g(req), req.params.rid, req.params.ajusteId, v.ajusteUpdate.parse(req.body)))),
  removeAjuste: handle(async (req, res) => ApiResponse.success(res, await service.deleteAjuste(g(req), req.params.rid, req.params.ajusteId))),
  setReserve: handle(async (req, res) => ApiResponse.success(res, await service.setReserve(g(req), req.params.rid, v.reserve.parse(req.body)))),
  setLineOrder: handle(async (req, res) => ApiResponse.success(res, await service.setLineOrder(g(req), req.params.rid, v.lineOrder.parse(req.body).keys))),
  close: handle(async (req, res) => ApiResponse.success(res, await service.closeRendicion(g(req), req.params.rid, req.user.id))),
  reopen: handle(async (req, res) => ApiResponse.success(res, await service.reopenRendicion(g(req), req.params.rid))),
  removeRendicion: handle(async (req, res) => {
    await service.deleteRendicion(g(req), req.params.rid);
    return ApiResponse.success(res, null, 'Rendición eliminada');
  }),
  download: handle(async (req, res) => {
    const format = req.params.format;
    if (format !== 'docx' && format !== 'pdf') return ApiResponse.badRequest(res, 'Formato inválido: usá docx o pdf');
    return sendFile(res, await service.generateDocument(g(req), req.params.rid, format));
  }),
};

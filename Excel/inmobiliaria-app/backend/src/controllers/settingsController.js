// Settings Controller - Group company configuration
const ApiResponse = require('../utils/apiResponse');

const prisma = require('../lib/prisma');

const SETTINGS_FIELDS = {
  logo: true,
  companyName: true,
  address: true,
  phone: true,
  email: true,
  cuit: true,
  localidad: true,
  ingBrutos: true,
  fechaInicioAct: true,
  ivaCondicion: true,
  subtitulo: true,
  bankName: true,
  bankHolder: true,
  bankCuit: true,
  bankAccountType: true,
  bankAccountNumber: true,
  bankCbu: true,
};

// GET /api/groups/:groupId/settings
const getSettings = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        ...SETTINGS_FIELDS,
      },
    });

    if (!group) {
      return ApiResponse.notFound(res, 'Grupo no encontrado');
    }

    return ApiResponse.success(res, group);
  } catch (error) {
    next(error);
  }
};

// PUT /api/groups/:groupId/settings
const updateSettings = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const {
      companyName, address, phone, email, cuit, localidad, logo,
      ingBrutos, fechaInicioAct, ivaCondicion, subtitulo,
      bankName, bankHolder, bankCuit, bankAccountType, bankAccountNumber, bankCbu,
    } = req.body;

    // Validate logo size if provided (~5MB base64 limit)
    if (logo && logo.length > 7_000_000) {
      return ApiResponse.badRequest(res, 'El logo es demasiado grande (max ~5MB)');
    }

    const updateData = {};
    if (companyName !== undefined) updateData.companyName = companyName;
    if (address !== undefined) updateData.address = address;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (cuit !== undefined) updateData.cuit = cuit;
    if (localidad !== undefined) updateData.localidad = localidad;
    if (logo !== undefined) updateData.logo = logo;
    if (ingBrutos !== undefined) updateData.ingBrutos = ingBrutos;
    if (fechaInicioAct !== undefined) updateData.fechaInicioAct = fechaInicioAct;
    if (ivaCondicion !== undefined) updateData.ivaCondicion = ivaCondicion;
    if (subtitulo !== undefined) updateData.subtitulo = subtitulo;
    if (bankName !== undefined) updateData.bankName = bankName;
    if (bankHolder !== undefined) updateData.bankHolder = bankHolder;
    if (bankCuit !== undefined) updateData.bankCuit = bankCuit;
    if (bankAccountType !== undefined) updateData.bankAccountType = bankAccountType;
    if (bankAccountNumber !== undefined) updateData.bankAccountNumber = bankAccountNumber;
    if (bankCbu !== undefined) updateData.bankCbu = bankCbu;

    const group = await prisma.group.update({
      where: { id: groupId },
      data: updateData,
      select: {
        id: true,
        name: true,
        ...SETTINGS_FIELDS,
      },
    });

    return ApiResponse.success(res, group, 'Configuracion actualizada');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSettings,
  updateSettings,
};

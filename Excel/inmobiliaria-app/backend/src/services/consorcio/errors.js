// Error de dominio del módulo Consorcios. `code` es estable (lo usan la UI y
// los tests); `status` es el HTTP que devuelve el controller; `details` lleva
// datos para explicarle al usuario qué falló (renglón del PDF, ids, etc.).
class ConsorcioError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'ConsorcioError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

module.exports = { ConsorcioError };

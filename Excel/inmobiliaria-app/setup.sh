#!/bin/bash

echo "=========================================="
echo "  Inmobiliaria App - Setup Script"
echo "=========================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}1. Instalando dependencias del backend...${NC}"
cd backend
npm install

echo -e "${YELLOW}2. Generando cliente Prisma...${NC}"
npm run db:generate

echo -e "${GREEN}Backend listo!${NC}"

echo -e "${YELLOW}3. Instalando dependencias del frontend...${NC}"
cd ../frontend
npm install

echo -e "${GREEN}Frontend listo!${NC}"

echo ""
echo "=========================================="
echo -e "${GREEN}Setup completado!${NC}"
echo "=========================================="
echo ""
echo "Proximos pasos:"
echo ""
echo "1. Configura tu base de datos Supabase:"
echo "   - Ve a https://supabase.com"
echo "   - Crea un proyecto"
echo "   - Copia el connection string"
echo "   - Pegalo en backend/.env como DATABASE_URL"
echo ""
echo "2. Ejecuta las migraciones:"
echo "   cd backend && npm run db:push && npm run db:seed"
echo ""
echo "3. Inicia los servidores:"
echo "   Terminal 1: cd backend && npm run dev"
echo "   Terminal 2: cd frontend && npm run dev"
echo ""
echo "4. Abre http://localhost:5173"
echo ""
echo "Credenciales de prueba:"
echo "  admin@hh.com / Password123"
echo "  paco@hh.com / Password123"
echo "  pedro@hh.com / Password123"
echo ""

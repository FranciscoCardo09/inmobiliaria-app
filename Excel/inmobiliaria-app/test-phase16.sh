#!/bin/bash

# Test Phase 1.6 - Email Verification & Password Reset

BASE_URL="http://localhost:3001/api"

echo "=========================================="
echo "PHASE 1.6 - TESTING"
echo "=========================================="
echo ""

# Test 1: Register new user
echo "1. Testing Registration (should NOT auto-login)..."
REGISTER_RESPONSE=$(curl -s -X POST ${BASE_URL}/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User Phase16",
    "email": "testphase16@example.com",
    "password": "password123"
  }')

echo "$REGISTER_RESPONSE" | python3 -m json.tool
echo ""
echo "Expected: User registered but NO access/refresh tokens"
echo ""

# Extract user ID for later use
USER_EMAIL="testphase16@example.com"

# Test 2: Try to login with unverified email
echo "2. Testing Login with unverified email (should be blocked)..."
LOGIN_RESPONSE=$(curl -s -X POST ${BASE_URL}/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testphase16@example.com",
    "password": "password123"
  }')

echo "$LOGIN_RESPONSE" | python3 -m json.tool
echo ""
echo "Expected: Error saying email not verified"
echo ""

# Test 3: Forgot password
echo "3. Testing Forgot Password..."
FORGOT_RESPONSE=$(curl -s -X POST ${BASE_URL}/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testphase16@example.com"
  }')

echo "$FORGOT_RESPONSE" | python3 -m json.tool
echo ""
echo "Expected: Success message (even if email doesn't exist)"
echo ""

echo "=========================================="
echo "MANUAL TESTS NEEDED:"
echo "1. Check database for verification token"
echo "2. Get token and test /auth/verify-email"
echo "3. Get reset token and test /auth/reset-password"
echo "=========================================="

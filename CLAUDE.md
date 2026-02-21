# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MetatronOS is a single-user AI-controlled operating system that runs inside a Docker container on a Linux VPS. An external LLM connects via API to control the system. Users interact through a browser (PWA), mobile, or desktop client over HTTPS (REST + WebSocket).

## Architecture

Single-container monorepo with TypeScript everywhere:

- **Frontend**: React 18 SPA built with Vite, styled with Tailwind CSS. Served as static files by the backend in production. No SSR — this is single-user behind auth.
- **Backend**: Fastify (Node.js 20 LTS) — persistent process (not serverless) for WebSocket connections, PTY sessions, cron scheduling, and the Pulse loop.
- **Database**: SQLite via better-sqlite3, with Drizzle ORM for type-safe queries and shared TypeScript types.
- **Shell Bridge**: node-pty for full PTY emulation — captures stdout/stderr, supports interactive programs.
- **Realtime**: WebSockets (@fastify/websocket) for streaming LLM responses, live shell output, and command approvals.
- **Queue**: BullMQ + Redis (or in-process queue) for scheduled tasks and agent pipeline jobs.
- **Encryption**: AES-256-GCM (Node.js crypto) for API keys and sensitive data.

## Key Design Constraints

- **Single-user, single-container**: No multi-tenancy, no user management, no RBAC. One user, one VPS.
- **LLM-friendly tech choices**: React, Fastify, and TypeScript were chosen specifically because they have the most LLM training data, reducing AI-generated bugs.
- **Backend must be persistent**: WebSocket connections, PTY sessions, cron, and the Pulse loop all require a long-running process.
- **Type sharing**: Drizzle ORM types are shared between frontend and backend in the monorepo.

## State Management

- **Zustand** for client-side UI state (lightweight, simple API).
- **TanStack Query** for server state (caching, refetching, loading states).
- **React Router v6** for client-side routing.

## Current Status

The project is in the planning/specification phase. The README contains the full architecture document. No implementation code exists yet.

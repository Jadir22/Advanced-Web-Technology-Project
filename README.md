# LostLink

LostLink is a privacy-first automated lost-and-found matching platform designed to help owners and finders reconnect lost items securely.

Unlike traditional lost-and-found platforms, LostLink does not provide a public feed for browsing lost or found items. Instead, users submit structured reports, and the system internally identifies potential matches based on item details, location, date, category-specific attributes, and description similarity.

## Project Overview

LostLink allows users to:

- Report a lost item
- Report a found item
- Receive potential matches automatically
- Review limited match information privately
- Confirm a potential match from both sides
- Unlock detailed information and in-app chat after match confirmation
- Communicate securely through the platform
- Mark an item as recovered after successful return

## Core Features

- User registration and authentication
- Lost and Found report submission
- Category-based dynamic report fields
- Private report system with no public lost/found feed
- Automated candidate filtering
- Weighted similarity-based matching
- Potential match notifications
- Both-side match confirmation
- Tk 10 Match Unlock through bKash
- Server-side payment verification
- Description unlock after successful payment
- In-app chat between matched users
- Report and recovery status tracking

## Item Categories

LostLink currently supports:

- Gadgets
- Wallet / Purse
- Money / Taka
- Documents
- Keys
- Bag
- Jewelry
- Books / Academic Items
- Clothing / Accessories
- Other

Each category contains relevant dynamic fields to improve matching accuracy.

## Matching System

LostLink uses a two-stage matching approach:

### 1. Candidate Filtering

The system first filters opposite-type reports using factors such as:

- Report type
- Report status
- Category
- Item type
- Area overlap
- Date proximity

### 2. Similarity Scoring

Filtered reports are then compared using a weighted score based on:

- Category
- Item type
- Area
- Category-specific attributes
- Specific place
- Date
- Description similarity

Potential matches are generated when the calculated score reaches the required threshold.

The initial implementation uses rule-based and text-similarity techniques without requiring AI or machine learning.

## Privacy and Security

LostLink is designed with privacy as a core principle.

- Lost and Found reports are not publicly searchable.
- Detailed descriptions remain hidden before match unlock.
- Direct contact information is not automatically exposed.
- Both users must confirm a potential match before the unlock process.
- The owner pays a Tk 10 Match Unlock Fee through bKash.
- Payment must be verified by the backend before access is unlocked.
- After successful unlock, users can communicate through the in-app chat.
- Sensitive document identifiers such as full NID or passport numbers are not required.

## Technology Stack

### Backend
- NestJS
- TypeScript
- TypeORM
- PostgreSQL

### Frontend
- Next.js
- TypeScript

### Other Technologies
- bKash Payment Integration
- WebSocket / Socket.IO for real-time communication
- Class Validator for request validation
- Git and GitHub for version control

## Project Structure

```text
Advanced-Web-Technology-Project/
└── LostLink/
    ├── backend/
    │   └── NestJS Backend
    │
    └── frontend/
        └── Next.js Frontend
```

The backend is being developed using the NestJS boilerplate provided for the course.

## Backend Architecture

The project follows a modular NestJS structure.

```text
Entity
  ↓
DTO
  ↓
Service
  ↓
Controller
  ↓
Module
  ↓
TypeORM Repository
  ↓
PostgreSQL
```

Planned modules include:

```text
user/
category/
report/
match/
payment/
chat/
notification/
```

## Team

**Group 3**

- Junayed Islam — 23-50150-1
- Masudur Rahman — 23-50797-1
- Al Muqtadir Sifat — 23-50146-1
- Abdulla — 23-50169-1

## Course Information

**Course:** Advanced Programming in Web Technology (CSC4161)  
**Semester:** Fall 2026-2027  
**Section:** B  
**Institution:** American International University-Bangladesh

## Current Development Status

The project is currently under active development.

Completed planning work includes:

- Project requirements
- Category and dynamic field design
- Required and optional field specification
- Lost and Found report form structure
- User flow
- Matching algorithm specification
- Landing page UI design
- Backend project setup

Backend module implementation and frontend development will continue in the next phases.

## Repository

This repository contains the source code, documentation, and development files for the LostLink project.

---

**LostLink — Reconnecting belongings through secure and private matching.**

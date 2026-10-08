"""Мансап Компасы — барлық дереккөздерге ортақ вакансия моделі.

Әр коллектор (hh.kz, LinkedIn, Enbek.kz) өз форматын осы бірыңғай Vacancy
құрылымына түрлендіреді, содан кейін ол SQLite базасына сақталады.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class Vacancy:
    source: str                      # 'hh.kz' | 'LinkedIn' | 'Enbek.kz'
    external_id: str                 # дереккөздегі вакансия ID-і
    url: str                         # вакансияның түпнұсқа сілтемесі
    title: str                       # лауазым атауы
    company: Optional[str] = None
    city: Optional[str] = None       # дереккөздегі қала атауы
    region: Optional[str] = None     # сайттағы 8 өңірдің бірі (Алматы, Астана, ...) немесе None
    salary_from: Optional[float] = None
    salary_to: Optional[float] = None
    currency: Optional[str] = None   # 'KZT', 'RUB', 'USD', ...
    experience: Optional[str] = None # 'noExperience' | 'between1And3' | 'between3And6' | 'moreThan6'
    published_at: Optional[str] = None  # ISO 8601, мыс. '2026-10-07T12:00:00+05:00'
    description: str = ''            # вакансия мәтіні (HTML тегтерінсіз)
    skills: list[str] = field(default_factory=list)  # дағдылардың қазақша канондық атаулары
    query: Optional[str] = None      # қай іздеу сұрауымен табылды

    def to_dict(self) -> dict:
        return asdict(self)

@echo off
chcp 65001 >nul
title Atualizador de Estoque - AgroConfianca
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizador\atualizar-estoque.ps1"

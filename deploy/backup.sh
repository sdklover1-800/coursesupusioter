#!/bin/sh
# Периодический дамп PostgreSQL.
#
# ВНИМАНИЕ: дампы содержат персональные данные студентов и транскрипты диалогов
# (DP-2 §13, см. COMPLIANCE.md). Каталог /backups обязан быть:
#   • с правами 700 на хосте,
#   • зашифрован при выносе за пределы сервера (age/gpg),
#   • реплицирован в хранилище в юрисдикции РК.
set -eu
umask 077

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DIR=/backups

echo "[backup] интервал ${INTERVAL}s, хранение ${KEEP_DAYS} дней, цель ${PGHOST}/${PGDATABASE}"

while true; do
	ts="$(date -u +%Y%m%dT%H%M%SZ)"
	out="${DIR}/edu_${ts}.sql.gz"

	if pg_dump --clean --if-exists --no-owner --no-privileges | gzip -9 >"${out}.part"; then
		mv "${out}.part" "${out}"
		echo "[backup] ok ${out} ($(du -h "${out}" | cut -f1))"
	else
		# Частичный файл удаляем: он неотличим от валидного дампа при восстановлении.
		rm -f "${out}.part"
		echo "[backup] ОШИБКА дампа ${ts}" >&2
	fi

	deleted="$(find "${DIR}" -name 'edu_*.sql.gz' -type f -mtime "+${KEEP_DAYS}" -print -delete | wc -l | tr -d ' ')"
	if [ "${deleted}" -gt 0 ]; then
		echo "[backup] удалено старых: ${deleted}"
	fi

	sleep "${INTERVAL}"
done

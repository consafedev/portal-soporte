#!/usr/bin/env python3
"""Valida la estructura local de la skill sin modificar el repositorio."""

from pathlib import Path
import re
import sys


def main() -> int:
    """Revisa metadatos y archivos requeridos de las skills del proyecto.

    Returns:
        Cero si la estructura es legible; uno cuando falta un requisito.
    """
    root = Path(__file__).resolve().parents[4]
    workflow = root / '.agents/skills/portal-soporte-workflow/SKILL.md'
    apple = root / '.agents/skills/apple-design/SKILL.md'
    files = [
        workflow,
        apple,
        root / '.agents/skills/portal-soporte-workflow/references/DOCUMENT_ROUTING.md',
        root / '.agents/skills/portal-soporte-workflow/references/UI_UX_APPLE_GATE.md',
        root / '.agents/skills/portal-soporte-workflow/references/ITERATION_HANDOFF.md',
        root / 'AGENTS.md',
    ]
    errors = [str(path) for path in files if not path.is_file()]
    if workflow.is_file():
        content = workflow.read_text(encoding='utf-8')
        match = re.match(r'\A---\n(?P<yaml>.*?)\n---\n', content, re.S)
        if not match or 'name: portal-soporte-workflow' not in match.group('yaml') or 'description:' not in match.group('yaml'):
            errors.append('SKILL.md: frontmatter de name/description inválido')
        if 'apple-design/SKILL.md' not in content:
            errors.append('SKILL.md: falta puerta Apple Design')
    if apple.is_file():
        # La skill Apple se valida únicamente por existencia/lectura. Nunca se edita aquí.
        apple.read_text(encoding='utf-8')
    policy = root / 'AGENTS.md'
    if policy.is_file():
        data = policy.read_text(encoding='utf-8')
        if 'portal-soporte-workflow/SKILL.md' not in data:
            errors.append('AGENTS.md: falta la obligación de leer portal-soporte-workflow')
        if '.agents/skills/apple-design/SKILL.md' not in data:
            errors.append('AGENTS.md: falta ruta de Apple Design')
    if errors:
        for error in errors:
            print(f'ERROR: {error}', file=sys.stderr)
        return 1
    print('OK: skills, referencias y política AGENTS.md verificadas.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

from pathlib import Path

patcher = Path('scripts/one_shot_finalize_gameplay_consistency.py')
text = patcher.read_text(encoding='utf-8')
old = '''old_clear_callback = "    this.lagCompensator?.clear_player(record.slot);\\n    this.options.onPlayerRespawned?.(record.id);"
clear_count = text.count(old_clear_callback)
if clear_count != 2:
    raise RuntimeError(f'respawn callbacks: expected 2, found {clear_count}')
text = text.replace(
    old_clear_callback,
    "    this.lagCompensator?.clear_player(record.slot);\\n    this.authoritativeRespawnCount += 1;\\n    this.options.onPlayerRespawned?.(record.id);",
)
'''
new = '''direct_clear_callback = "    this.lagCompensator?.clear_player(record.slot);\\n    this.options.onPlayerRespawned?.(record.id);"
if text.count(direct_clear_callback) != 1:
    raise RuntimeError('direct respawn callback pattern changed')
text = text.replace(
    direct_clear_callback,
    "    this.lagCompensator?.clear_player(record.slot);\\n    this.authoritativeRespawnCount += 1;\\n    this.options.onPlayerRespawned?.(record.id);",
    1,
)
timed_clear_callback = "        this.lagCompensator?.clear_player(record.slot);\\n        this.options.onPlayerRespawned?.(record.id);"
if text.count(timed_clear_callback) != 1:
    raise RuntimeError('timed respawn callback pattern changed')
text = text.replace(
    timed_clear_callback,
    "        this.lagCompensator?.clear_player(record.slot);\\n        this.authoritativeRespawnCount += 1;\\n        this.options.onPlayerRespawned?.(record.id);",
    1,
)
'''
if old not in text:
    raise RuntimeError('unable to patch one-shot callback matcher')
text = text.replace(old, new, 1)
patcher.write_text(text, encoding='utf-8')
exec(compile(text, str(patcher), 'exec'), {'__name__': '__main__'})

# APS Melody Engine — experimental worker

This worker is **not** a deployed singing-voice clone. It prepares a user-owned recording for conversion: Demucs two-stem separation and pYIN pitch analysis. It does not yet correct pitch or run RVC. The browser prototype at `/melody-engine.html` exports the requested settings locally.

## Requirements
- Python 3.11+
- FFmpeg on PATH
- `pip install -r requirements.txt`
- Demucs CLI installed separately (`pip install demucs`); GPU strongly recommended
- GPU-hosted, explicitly authorized RVC model and inference adapter **not yet connected**

## Local use
```bash
python engine.py "/path/to/quando-deus-entra_mixed.mp3" --output ./private-test --correction 65 --naturalness 85
pytest -q test_engine.py
```

Results include separated stems, a pitch curve and a manifest marked `prepared_not_converted`. Do not claim that the original melody has been corrected or that the user's voice was applied.

## Next development gates
1. Isolated GPU worker, private object storage, consent and model deletion controls.
2. Pitch-target note editor, correction preserving vibrato/formants and duration, with listening tests.
3. Authorized RVC training/inference, evaluation on the owner's clean voice recordings.
4. Mixdown with unchanged instrumental, level matching, clipping checks and A/B tests.
5. Authenticated asynchronous API, upload limits, quotas, signed URLs, observability and rollback.
6. Review before production exposure; avoid shipping an unfinished processing button.

No audio or model weights are committed to Git.

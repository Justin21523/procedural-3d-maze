# Audio Assets

This directory contains audio files for the game.

## Required Audio Files

### Ambient Sound
- `ambient.mp3` - Background atmosphere sound (looping)
  - Suggested: Air conditioning hum, fluorescent light buzz (Backrooms style)
  - Length: 10-30 seconds (will loop)

### Player Sounds
- `footstep_walk.mp3` - Walking footstep sound
  - Short, subtle footstep on tile/concrete
  - Length: ~0.2-0.3 seconds

- `footstep_run.mp3` - Running footstep sound
  - Louder, faster footstep
  - Length: ~0.2-0.3 seconds

### Monster Sounds
- `monster_idle.mp3` - Monster idle/breathing sound (looping)
  - Subtle breathing or growling
  - Length: 2-5 seconds (will loop)

- `monster_chase.mp3` - Monster chase alert sound (one-shot)
  - Aggressive roar or scream
  - Length: 1-3 seconds

### Game Event Sounds
- `caught.mp3` - Player caught by monster
  - Scary sound effect
  - Length: 1-2 seconds

- `exit_found.mp3` - Exit found success sound
  - Victory/success sound
  - Length: 1-3 seconds

## File Format
- **Format**: MP3 (widely supported)
- **Sample Rate**: 44.1kHz or 48kHz
- **Bitrate**: 128-192 kbps (good quality, reasonable file size)

## Free Sound Resources

You can find free sound effects at:
- [Freesound.org](https://freesound.org/)
- [OpenGameArt.org](https://opengameart.org/)
- [ZapSplat](https://www.zapsplat.com/)
- [Sonniss Game Audio GDC Bundles](https://sonniss.com/gameaudiogdc)

## Placeholder Files

For development, you can use silent/minimal audio files, or the AudioManager will gracefully handle missing files by logging warnings but continuing to function.

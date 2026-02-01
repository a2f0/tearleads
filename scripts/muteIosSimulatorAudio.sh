#!/bin/sh
# Disable iOS Simulator audio to prevent crackling on host audio.
# This setting persists across simulator reboots.
defaults write com.apple.iphonesimulator MuteAudio -bool true

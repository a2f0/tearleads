#!/bin/sh
set -e

# Downloads the Gradle wrapper JAR from Gradle's GitHub repository.
# The version is extracted from gradle-wrapper.properties.
#
# IMPORTANT: The gradle-wrapper.jar is gitignored and must be downloaded
# before building. This script is called by CI workflows and should be
# run locally after cloning the repo.
#
# To update the Gradle version:
# 1. Edit android/gradle/wrapper/gradle-wrapper.properties
# 2. Update distributionUrl to the new version (e.g., gradle-8.12-all.zip)
# 3. Delete the existing gradle-wrapper.jar: rm android/gradle/wrapper/gradle-wrapper.jar
# 4. Run this script to download the new JAR: ./scripts/downloadGradleWrapper.sh
# 5. Test locally: cd android && ./gradlew assembleDebug
#
# DO NOT regenerate the wrapper using `gradle wrapper` with a different
# Gradle version than specified in gradle-wrapper.properties, as this can
# cause incompatibilities between the wrapper scripts (gradlew, gradlew.bat)
# and the JAR file.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
WRAPPER_DIR="$CLIENT_DIR/android/gradle/wrapper"
WRAPPER_JAR="$WRAPPER_DIR/gradle-wrapper.jar"
PROPERTIES_FILE="$WRAPPER_DIR/gradle-wrapper.properties"

# Check if jar already exists
if [ -f "$WRAPPER_JAR" ]; then
    echo "gradle-wrapper.jar already exists at $WRAPPER_JAR"
    exit 0
fi

# Extract Gradle version from properties file
if [ ! -f "$PROPERTIES_FILE" ]; then
    echo "Error: gradle-wrapper.properties not found at $PROPERTIES_FILE"
    exit 1
fi

# Parse version from distributionUrl (e.g., gradle-8.11.1-all.zip)
GRADLE_VERSION=$(grep "distributionUrl" "$PROPERTIES_FILE" | sed 's/.*gradle-\([0-9.]*\)-.*/\1/')

if [ -z "$GRADLE_VERSION" ]; then
    echo "Error: Could not parse Gradle version from $PROPERTIES_FILE"
    exit 1
fi

echo "Detected Gradle version: $GRADLE_VERSION"

# Download from Gradle GitHub repository
DOWNLOAD_URL="https://raw.githubusercontent.com/gradle/gradle/v${GRADLE_VERSION}/gradle/wrapper/gradle-wrapper.jar"

echo "Downloading gradle-wrapper.jar from Gradle GitHub..."
echo "  URL: $DOWNLOAD_URL"

mkdir -p "$WRAPPER_DIR"

if command -v curl > /dev/null 2>&1; then
    curl -fSL -o "$WRAPPER_JAR" "$DOWNLOAD_URL"
elif command -v wget > /dev/null 2>&1; then
    wget -q -O "$WRAPPER_JAR" "$DOWNLOAD_URL"
else
    echo "Error: Neither curl nor wget found. Please install one of them."
    exit 1
fi

echo "Downloaded gradle-wrapper.jar to $WRAPPER_JAR"

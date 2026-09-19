# `C_ProfileData` — the complete field reference

Every field the decoded profile save carries: all **714 typed properties**, all **9 SQLite tables** with every
column, and the region offsets. Companion to [`format-c-profiledata.md`](format-c-profiledata.md), which explains
the *structure* — this file is the exhaustive *inventory*.

*Generated 2026-09-18 from a live offline decrypt (`scripts/tools/fh6_local_decrypt`) of this machine's save:
3,610,501 bytes. Nothing here is transcribed by hand. Regenerate it the same way after a game update — the offsets move
with every save, the field set does not.*

## Region map (this capture)

| Region | Offset | Size | Contents |
| --- | ---: | ---: | --- |
| Header | 0 | 12 B | magic `0x4a8bf2b6`, property-tree end `27,092`, 21 top-level groups |
| Property tree | 12 | 27,080 B | 714 typed properties (§1) |
| BXML | 27,108 | — | magic `BXML`, version 2 |
| Interned strings | 27,123 | 50,388 B | 1,906 entries, `[u16 len][bytes]` (§3) |
| Binary records | 77,511 | 2,521,278 B | per-car state records, framing undecoded |
| Embedded SQLite | 2,598,789 | 1,011,712 B | the career database (§2) |

## 1. Every typed property (714)

Record framing and the type codes are explained in the companion doc. `value` is this capture's own reading —
it shows the shape and unit of the field, not a constant. Groups (type 15) carry a child count as their payload;
the properties under a group heading are the ones that follow it in the file.

| # | property | type | bytes | value (this capture) |
| ---: | --- | --- | ---: | --- |
| 1 | **MouseControlOptions** | GROUP (payload = child count) | 4 | 4 children |
| 2 | `MouseLookLeftRightSensitivity` | float32 | 4 | 1.0 |
| 3 | `MouseLookUpDownSensitivity` | float32 | 4 | 1.0 |
| 4 | `MouseLookUpDownInvert` | bool (1 B) | 1 | 0 |
| 5 | `MouseLookWheelZoomSensitivity` | float32 | 4 | 1.0 |
| 6 | **BristolOptions** | GROUP (payload = child count) | 4 | 8 children |
| 7 | `RewindOnBack` | u32 flag | 4 | 0 |
| 8 | `RumbleSetting` | u32 flag | 4 | 1 |
| 9 | `InvertHandbrakeClutch` | u32 flag | 4 | 0 |
| 10 | `Layout` | u32 flag | 4 | 0 |
| 11 | `InvertAnnaTelemetry` | u32 flag | 4 | 0 |
| 12 | `InvertGearUpDown` | u32 flag | 4 | 0 |
| 13 | `InvertCameraLookBack` | u32 flag | 4 | 0 |
| 14 | `InvertHornPhotoMode` | u32 flag | 4 | 0 |
| 15 | **Main** | GROUP (payload = child count) | 4 | 242 children |
| 16 | `HDRSaturation` | float32 | 4 | 0.5 |
| 17 | `Crowds` | u32 | 4 | 0 |
| 18 | `NumSkillTokens` | u32 | 4 | 9986 |
| 19 | `Horns` | bool / small enum (1 B) | 1 | 1 |
| 20 | `Captions` | bool / small enum (1 B) | 1 | 0 |
| 21 | `Color` | float32 | 4 | 0.7 |
| 22 | `Focus` | float32 | 4 | 0.41 |
| 23 | `TotalSkills` | u64 | 8 | 19617672 |
| 24 | `NumUltimateWreckages` | u32 | 4 | 2015 |
| 25 | `NumUltimateJTurns` | u32 | 4 | 365 |
| 26 | `SignLanguageVideoPositionOnScreen` | bool / small enum (1 B) | 1 | 3 |
| 27 | `AvgLeftFrontTireTemp` | float32 | 4 | 131.544 |
| 28 | `NumUltimateSpeeds` | u32 | 4 | 1300 |
| 29 | `HomespaceTrackId` | u32 | 4 | 319 |
| 30 | `TotalRepairs` | u32 | 4 | 0 |
| 31 | `AvgLeftFrontSuspensionStroke` | float32 | 4 | 0.0581 |
| 32 | `ProximityRadarVolume` | float32 | 4 | 1.0 |
| 33 | `InitialExperienceState` | bool / small enum (1 B) | 1 | 0 |
| 34 | `NumKingGames` | u32 | 4 | 0 |
| 35 | `Xbox60HzMode` | bool / small enum (1 B) | 1 | 0 |
| 36 | `CurrentCampaign` | u32 flag | 4 | 0 |
| 37 | `BpmMatchedEnviornment` | bool (1 B) | 1 | 1 |
| 38 | `RallyCoDriverVoicesPaceNotes` | bool / small enum (1 B) | 1 | 1 |
| 39 | `AvgRightRearTireLoad` | float32 | 4 | 32.7825 |
| 40 | `IsEstateVisitable` | bool (1 B) | 1 | 1 |
| 41 | `HueShift` | float32 | 4 | 0.0 |
| 42 | `NumUltimateEDrifts` | u32 | 4 | 642 |
| 43 | `MaxLeftRearTireTemp` | float32 | 4 | 760498560.0 |
| 44 | `EmotePose` | u32 flag | 4 | 0 |
| 45 | `LastMultiplayerCar` | u32 | 4 | 3655 |
| 46 | `LiveryBackgroundState` | bool / small enum (1 B) | 1 | 3 |
| 47 | `ColorGradingDeut` | float32 | 4 | 0.0 |
| 48 | `ColorGradingTrit` | float32 | 4 | 0.0 |
| 49 | `TimeInAuctionHouse` | u32 | 4 | 0 |
| 50 | `HDRWhitePoint` | float32 | 4 | 1000.0 |
| 51 | `AvgRightFrontSuspensionStroke` | float32 | 4 | 0.0577 |
| 52 | `HorizonLifeConnectionPreference` | bool / small enum (1 B) | 1 | 0 |
| 53 | `ColorblindMode` | bool / small enum (1 B) | 1 | 0 |
| 54 | `HighestSkillScore` | u32 | 4 | 710100 |
| 55 | `LongestDrift` | float32 | 4 | 11653.5225 |
| 56 | `CareerCar` | u32 | 4 | 1322 |
| 57 | `CurrentRaceId` | u32 | 4 | 0 |
| 58 | `Flags` | u64 | 8 | 0 |
| 59 | `HDRUIExposurePC` | float32 | 4 | 200.0 |
| 60 | `LastAccoladePointUploaded` | u32 | 4 | 0 |
| 61 | `RivalsCompletionTracking` | u64 | 8 | 0 |
| 62 | `LongestJump` | float32 | 4 | 7450.7051 |
| 63 | `HDRContentExposurePC` | float32 | 4 | 200.0 |
| 64 | `HDRBrightness` | float32 | 4 | 0.5 |
| 65 | `LaunchControl` | bool / small enum (1 B) | 1 | 0 |
| 66 | `WasRateGamePopupShown` | bool (1 B) | 1 | 0 |
| 67 | `SubtitlesTextSize` | float32 | 4 | 18.0 |
| 68 | `PlayerCardTitleId` | u32 | 4 | 326 |
| 69 | `Temperature` | float32 | 4 | 0.5 |
| 70 | `Braking` | bool / small enum (1 B) | 1 | 1 |
| 71 | `DriverPositions` | u32 | 4 | 0 |
| 72 | `SubtitlesHighlightKeywords` | bool (1 B) | 1 | 0 |
| 73 | `NumLinearPlayRaces` | u32 | 4 | 0 |
| 74 | `MenuMusic` | bool / small enum (1 B) | 1 | 1 |
| 75 | `UIVolume` | float32 | 4 | 1.0 |
| 76 | `PlaybackSystem` | bool / small enum (1 B) | 1 | 4 |
| 77 | `PrivateLicensePlate` | var-length | 12 |  |
| 78 | `MaxRightFrontTireTemp` | float32 | 4 | 161863057408.0 |
| 79 | `AvgRightFrontTireTemp` | float32 | 4 | 131.9232 |
| 80 | `MaxLeftFrontTireLoad` | float32 | 4 | 70583.2266 |
| 81 | `VOVolume` | float32 | 4 | 1.0 |
| 82 | `Subtitles` | bool / small enum (1 B) | 1 | 1 |
| 83 | `NumUltimateDrafts` | u32 | 4 | 131 |
| 84 | `IsXPIntroduced` | bool (1 B) | 1 | 1 |
| 85 | `SamplingMode` | u32 | 4 | 0 |
| 86 | `ActiveEstateId` | var-length | 40 |  |
| 87 | `ShowroomControllerTutorialCompleted` | bool (1 B) | 1 | 0 |
| 88 | `FocusMode` | u32 | 4 | 0 |
| 89 | `DistanceDriven` | u32 | 4 | 4155967855 |
| 90 | `TractionControl` | bool / small enum (1 B) | 1 | 1 |
| 91 | `AvgLeftRearTireLoad` | float32 | 4 | 34.1115 |
| 92 | `MasterVolume` | float32 | 4 | 0.75 |
| 93 | `LastMessageCenterDay` | bool / small enum (1 B) | 1 | 0 |
| 94 | `Creatures` | u32 | 4 | 0 |
| 95 | `RaceStatsId` | u32 | 4 | 0 |
| 96 | `ScreenReaderPlatformOverride` | bool / small enum (1 B) | 1 | 0 |
| 97 | `TractionAndStabilityControl` | bool / small enum (1 B) | 1 | 1 |
| 98 | `LFEVolume` | float32 | 4 | 1.0 |
| 99 | `SatNavVolume` | float32 | 4 | 1.0 |
| 100 | `NumInfectedGames` | u32 | 4 | 0 |
| 101 | `RadioVolume` | float32 | 4 | 0.0 |
| 102 | `TotalCredits` | u64 | 8 | 999999999 |
| 103 | `MaxRightRearTireTemp` | float32 | 4 | 1259946624.0 |
| 104 | `WheelTilt` | u32 | 4 | 0 |
| 105 | `NumUltimateNearMisses` | u32 | 4 | 43 |
| 106 | `TokensHidden` | u32 | 4 | 0 |
| 107 | `SuggestedLine` | bool / small enum (1 B) | 1 | 0 |
| 108 | `ShowroomCarColor` | u32 flag | 4 | 1 |
| 109 | `InvertVerticalCamera` | u32 flag | 4 | 0 |
| 110 | `MaxRightRearSuspensionStroke` | float32 | 4 | 0.5716 |
| 111 | `NumUltimateAirs` | u32 | 4 | 1859 |
| 112 | `LastLogIn` | u32 | 4 | 1789732928 |
| 113 | `RadioDJ` | bool / small enum (1 B) | 1 | 1 |
| 114 | `HDRUIExposure` | float32 | 4 | 1400.0 |
| 115 | `CarLights` | u32 | 4 | 0 |
| 116 | `AvgLeftRearSuspensionStroke` | float32 | 4 | 0.0283 |
| 117 | `GPSVoice` | bool / small enum (1 B) | 1 | 1 |
| 118 | `NumUltimatePasses` | u32 | 4 | 401 |
| 119 | `LastRewardedLevel` | u32 | 4 | 0 |
| 120 | `TimeInShowroomNatal` | u32 | 4 | 0 |
| 121 | `MaxBrakingGs` | float32 | 4 | 19.8885 |
| 122 | `AvgBrakingGs` | float32 | 4 | 0.4147 |
| 123 | `SignLanguageBackgroundColor` | bool / small enum (1 B) | 1 | 0 |
| 124 | `IsCreditsIntroduced` | bool (1 B) | 1 | 1 |
| 125 | `ColorGradingProt` | float32 | 4 | 0.0 |
| 126 | `DamageFuelWear` | bool / small enum (1 B) | 1 | 0 |
| 127 | `PreviousLogIn` | u32 | 4 | 1789628795 |
| 128 | `AuctionsOpen` | u32 | 4 | 29 |
| 129 | `TotalDrivatarPayout` | u32 | 4 | 0 |
| 130 | `TotalStorefrontPayout` | u32 | 4 | 0 |
| 131 | `SFXFocus` | bool / small enum (1 B) | 1 | 0 |
| 132 | `TimeDrivenInFreeroam` | u32 | 4 | 86 |
| 133 | `TimeAccelerating` | u32 | 4 | 620756992 |
| 134 | `PerfectAutocrossCount` | bool / small enum (1 B) | 1 | 0 |
| 135 | `NumUltimateOneEighties` | u32 | 4 | 425 |
| 136 | `Streaming_TractionControl` | bool / small enum (1 B) | 1 | 0 |
| 137 | `LastMultiplayerTrack` | u32 | 4 | 8 |
| 138 | `DriverModelId` | bool / small enum (1 B) | 1 | 0 |
| 139 | `Brightness` | float32 | 4 | 0.72 |
| 140 | `MasterGameVolume` | float32 | 4 | 1.0 |
| 141 | `CareerCoopPrivacy` | bool / small enum (1 B) | 1 | 0 |
| 142 | `HighestSkillCar` | u32 | 4 | 363 |
| 143 | `ShutterSpeed` | float32 | 4 | 0.91 |
| 144 | `Rewind` | bool / small enum (1 B) | 1 | 0 |
| 145 | `MaxLateralGs` | float32 | 4 | 18.1898 |
| 146 | `AvgLateralGs` | float32 | 4 | 0.2336 |
| 147 | `TopSpeed` | float32 | 4 | 134.112 |
| 148 | `AvgLeftFrontTireLoad` | float32 | 4 | 29.5328 |
| 149 | `IsUltimateVip` | bool (1 B) | 1 | 0 |
| 150 | `LastMessageCenterMonth` | bool / small enum (1 B) | 1 | 0 |
| 151 | `Guidelines` | u32 | 4 | 0 |
| 152 | `SoloGameSpeed` | float32 | 4 | 100.0 |
| 153 | `NumPodiums` | u32 | 4 | 818 |
| 154 | `TimeDriven` | u32 | 4 | 1473598 |
| 155 | `TimeInAllMenus` | u32 | 4 | 0 |
| 156 | `NumRaces` | u32 | 4 | 1017 |
| 157 | `CarCollisions` | u32 | 4 | 70530307 |
| 158 | `TimeInStorefront` | u32 | 4 | 0 |
| 159 | `Drivers` | u32 | 4 | 0 |
| 160 | `Streaming_LaunchControl` | bool / small enum (1 B) | 1 | 0 |
| 161 | `BokehShape` | u32 | 4 | 0 |
| 162 | `AvgRightRearTireTemp` | float32 | 4 | 140.2853 |
| 163 | `MaxLeftRearTireLoad` | float32 | 4 | 68022.8359 |
| 164 | `CurrentMiniCareerId` | u32 | 4 | 0 |
| 165 | `Streaming_StuntDriving` | bool / small enum (1 B) | 1 | 0 |
| 166 | `Level` | u32 | 4 | 16 |
| 167 | `Steering` | bool / small enum (1 B) | 1 | 3 |
| 168 | `SignLanguageMode` | bool / small enum (1 B) | 1 | 0 |
| 169 | `Sepia` | float32 | 4 | 0.0 |
| 170 | `Exposure` | float32 | 4 | 0.58 |
| 171 | `LastSuspendTimestamp` | u64 | 8 | 0 |
| 172 | `TimeBraking` | u32 | 4 | 23727 |
| 173 | `Streaming_Braking` | bool / small enum (1 B) | 1 | 1 |
| 174 | `Streaming_StabilityControl` | bool / small enum (1 B) | 1 | 1 |
| 175 | `Streaming_ClassRestriction` | bool / small enum (1 B) | 1 | 1 |
| 176 | `Contrast` | float32 | 4 | 0.79 |
| 177 | `SignLanguageVideoSize` | bool / small enum (1 B) | 1 | 1 |
| 178 | `CurrentNumberOfMessagesDownloaded` | u32 | 4 | 0 |
| 179 | `Credits` | index / ref | 4 | 7082491 |
| 180 | `Weather` | u32 | 4 | 0 |
| 181 | `UpTime` | u64 | 8 | 75319633593 |
| 182 | `AIDiff` | bool / small enum (1 B) | 1 | 4 |
| 183 | `TotalWinnings` | u32 | 4 | 1449223451 |
| 184 | `InitialSetupComplete` | bool (1 B) | 1 | 1 |
| 185 | `Streaming_Steering` | bool / small enum (1 B) | 1 | 2 |
| 186 | `AvgRightRearSuspensionStroke` | float32 | 4 | 0.0285 |
| 187 | `MouseFreeLook` | bool (1 B) | 1 | 1 |
| 188 | `LayerGroupImportCount` | u32 | 4 | 1 |
| 189 | `NumVictories` | u32 | 4 | 477 |
| 190 | `InRaceMusic` | bool / small enum (1 B) | 1 | 1 |
| 191 | `NumUltimateTwoWheels` | u32 | 4 | 30 |
| 192 | `Shifting` | bool / small enum (1 B) | 1 | 0 |
| 193 | `XPBoostEndDate` | u64 | 8 | 0 |
| 194 | `IsVip` | bool (1 B) | 1 | 0 |
| 195 | `TireVolume` | float32 | 4 | 1.0 |
| 196 | `UseDefaultEffects` | bool (1 B) | 1 | 0 |
| 197 | `StreamerMode` | bool / small enum (1 B) | 1 | 0 |
| 198 | `AICarsVolume` | float32 | 4 | 1.0 |
| 199 | `AvgRightFrontTireLoad` | float32 | 4 | 72571.6172 |
| 200 | `MaxRightFrontTireLoad` | float32 | 4 | 72575.9062 |
| 201 | `MaxLeftFrontTireTemp` | float32 | 4 | 44712300544.0 |
| 202 | `NumUltimateDrifts` | u32 | 4 | 1164 |
| 203 | `AudioPreset` | bool / small enum (1 B) | 1 | 0 |
| 204 | `CurrentEventId` | u32 | 4 | 0 |
| 205 | `Streaming_TractionAndStabilityControl` | bool / small enum (1 B) | 1 | 0 |
| 206 | `Streaming_Rewind` | bool / small enum (1 B) | 1 | 0 |
| 207 | `Streaming_MetaDiff` | bool / small enum (1 B) | 1 | 1 |
| 208 | `TimeInPaintShop` | u32 | 4 | 0 |
| 209 | `MaxRightFrontSuspensionStroke` | float32 | 4 | 0.5716 |
| 210 | `AerialVehiclesVolume` | float32 | 4 | 1.0 |
| 211 | `CarVolume` | float32 | 4 | 1.0 |
| 212 | `Aperture` | float32 | 4 | 0.03 |
| 213 | `ScreenReaderVolume` | float32 | 4 | 1.0 |
| 214 | `SubtitlesBackgroundOpacity` | float32 | 4 | 0.4 |
| 215 | `AvgLeftRearTireTemp` | float32 | 4 | 139.6786 |
| 216 | `ShowroomCar` | u32 flag | 4 | 1131 |
| 217 | `Streaming_SuggestedLineRally` | bool / small enum (1 B) | 1 | 1 |
| 218 | `Streaming_Shifting` | bool / small enum (1 B) | 1 | 0 |
| 219 | `Streaming_DamageFuelWear` | bool / small enum (1 B) | 1 | 1 |
| 220 | `Vignette` | float32 | 4 | 0.01 |
| 221 | `SFXVolume` | float32 | 4 | 1.0 |
| 222 | `MajorCollisions` | u32 | 4 | 0 |
| 223 | `NumAuctionHouseTransactions` | u32 | 4 | 395 |
| 224 | `MaxAccelerationGs` | float32 | 4 | 19.9845 |
| 225 | `TimeInUpgrades` | u32 | 4 | 0 |
| 226 | `MaxRightRearTireLoad` | float32 | 4 | 72367.8281 |
| 227 | `TimeInTestDrive` | u32 | 4 | 0 |
| 228 | `ClassRestriction` | bool / small enum (1 B) | 1 | 1 |
| 229 | `NumUltimateBurnouts` | u32 | 4 | 87 |
| 230 | `AvgAccelerationGs` | float32 | 4 | 0.0 |
| 231 | `AudioDescriptions` | bool / small enum (1 B) | 1 | 0 |
| 232 | `StabilityControl` | bool / small enum (1 B) | 1 | 1 |
| 233 | `MetaDiff` | bool / small enum (1 B) | 1 | 5 |
| 234 | `MaxLeftRearSuspensionStroke` | float32 | 4 | 0.5716 |
| 235 | `StuntDriving` | bool / small enum (1 B) | 1 | 1 |
| 236 | `TimeInShowroomController` | u32 | 4 | 0 |
| 237 | `HDRContentExposure` | float32 | 4 | 300.0 |
| 238 | `Gamma` | float32 | 4 | 0.1 |
| 239 | `TotalXP` | u64 | 8 | 19617672 |
| 240 | `OnlineWinnings` | u32 | 4 | 5009745 |
| 241 | `BidsOutstanding` | u32 | 4 | 53 |
| 242 | `MaxLeftFrontSuspensionStroke` | float32 | 4 | 0.5716 |
| 243 | `PartyPrivacy` | bool / small enum (1 B) | 1 | 1 |
| 244 | `SuggestedLineRally` | bool / small enum (1 B) | 1 | 1 |
| 245 | `PlayerCardBadgeId` | u32 | 4 | 63 |
| 246 | `MessageCenterVisits` | bool / small enum (1 B) | 1 | 0 |
| 247 | `LicensePlateValidationError` | bool (1 B) | 1 | 0 |
| 248 | `Streaming_SuggestedLine` | bool / small enum (1 B) | 1 | 0 |
| 249 | `PublicLicensePlate` | var-length | 12 |  |
| 250 | `RoadTripLocation` | u32 flag | 4 | 0 |
| 251 | `ShowroomKinectTutorialCompleted` | bool (1 B) | 1 | 0 |
| 252 | `TimeOfDay` | u32 | 4 | 0 |
| 253 | `Streaming_AIDiff` | bool / small enum (1 B) | 1 | 3 |
| 254 | `LatestSnapshotDataVersion` | u32 | 4 | 1 |
| 255 | `TimeInTuning` | u32 | 4 | 78778 |
| 256 | `CareerCarNext` | u32 | 4 | 1 |
| 257 | `XP` | index / ref | 4 | 19617672 |
| 258 | **HeadTracking** | GROUP (payload = child count) | 4 | 0 children |
| 259 | **ControllerOptions** | GROUP (payload = child count) | 4 | 9 children |
| 260 | `RewindOnBack` | u32 flag | 4 | 0 |
| 261 | `RumbleSetting` | u32 flag | 4 | 1 |
| 262 | `InvertHandbrakeClutch` | u32 flag | 4 | 0 |
| 263 | `Layout` | u32 flag | 4 | 15 |
| 264 | `InvertAnnaTelemetry` | u32 flag | 4 | 0 |
| 265 | `InvertGearUpDown` | u32 flag | 4 | 0 |
| 266 | `InvertCameraLookBack` | u32 flag | 4 | 0 |
| 267 | `DPad` | u32 flag | 4 | 0 |
| 268 | `InvertHornPhotoMode` | u32 flag | 4 | 0 |
| 269 | **WheelAdvancedOptions** | GROUP (payload = child count) | 4 | 26 children |
| 270 | `SteeringLinearity` | float32 | 4 | 0.5 |
| 271 | `WheelRotationAngle` | float32 | 4 | 900.0 |
| 272 | `WheelDamperScale` | float32 | 4 | 1.0 |
| 273 | `RumbleScale` | float32 | 4 | 0.5 |
| 274 | `SteeringLockRatio` | float32 | 4 | 1.0 |
| 275 | `ForceFeedbackScale` | float32 | 4 | 1.0 |
| 276 | `ForceFeedbackUndersteerFactor` | float32 | 4 | 1.0 |
| 277 | `HandbrakeDeadzoneInside` | float32 | 4 | 0.1 |
| 278 | `ThrottleDeadzoneOutside` | float32 | 4 | 1.0 |
| 279 | `ForceFeedbackOffroadFeelFactor` | float32 | 4 | 1.0 |
| 280 | `SteeringAxisDeadzoneOutside` | float32 | 4 | 1.0 |
| 281 | `ForceFeedbackMaxLateralForceFactor` | float32 | 4 | 1.0 |
| 282 | `ForceFeedbackLinearityFactor` | float32 | 4 | 1.0 |
| 283 | `HandbrakeDeadzoneOutside` | float32 | 4 | 1.0 |
| 284 | `SteeringRotation` | float32 | 4 | -1.0 |
| 285 | `ClutchDeadzoneInside` | float32 | 4 | 0.15 |
| 286 | `ClutchDeadzoneOutside` | float32 | 4 | 0.9 |
| 287 | `SteeringSensitivity` | float32 | 4 | 0.5 |
| 288 | `ForceFeedbackInvert` | bool (1 B) | 1 | 0 |
| 289 | `SteeringAxisDeadzoneInside` | float32 | 4 | 0.0 |
| 290 | `ForceFeedbackRoadFeelFactor` | float32 | 4 | 1.0 |
| 291 | `BrakeDeadzoneInside` | float32 | 4 | 0.0 |
| 292 | `CenterSpringScale` | float32 | 4 | 1.0 |
| 293 | `BrakeDeadzoneOutside` | float32 | 4 | 1.0 |
| 294 | `ThrottleDeadzoneInside` | float32 | 4 | 0.0 |
| 295 | `SteeringSpeedSensitivity` | float32 | 4 | 1.0 |
| 296 | **MiscStats** | GROUP (payload = child count) | 4 | 69 children |
| 297 | `SpeedZonesCompleted` | index / ref | 4 | 30 |
| 298 | `OnlineFriendsBeaten` | u32 | 4 | 68 |
| 299 | `FavouriteRoadTripCar` | u32 | 4 | 0 |
| 300 | `OnlineNumCollisionsInRaces` | u32 | 4 | 5517 |
| 301 | `StreetRacesEntered` | u32 | 4 | 78 |
| 302 | `XPLostToCollisions` | u32 | 4 | 0 |
| 303 | `TuningSetupsShared` | u32 | 4 | 64 |
| 304 | `UpgradesBoardsSmashed` | index / ref | 4 | 0 |
| 305 | `StreetRacesWon` | u32 | 4 | 0 |
| 306 | `PhotosTaken` | u32 | 4 | 399 |
| 307 | `OnlineXPWonFromCleanStreak` | u32 | 4 | 827010 |
| 308 | `MostFansFromAChampionship` | u32 | 4 | 0 |
| 309 | `TotalLineUpXPEarned` | u32 | 4 | 0 |
| 310 | `GaragePartsValue` | u32 | 4 | 32932090 |
| 311 | `OnlineStreetRacesWon` | u32 | 4 | 6 |
| 312 | `TotalCollisions` | u32 | 4 | 11529 |
| 313 | `OnlineXPWonFromCleanStarts` | u32 | 4 | 934560 |
| 314 | `OnlineTeamRacesEntered` | u32 | 4 | 74 |
| 315 | `MostFansFromAShowcase` | u32 | 4 | 0 |
| 316 | `XPSinglePlayerRaces` | u32 | 4 | 1930304 |
| 317 | `MostValuableCar` | u32 | 4 | 2793 |
| 318 | `LiveriesShared` | u32 | 4 | 0 |
| 319 | `OnlineTimeSpentInFreeroam` | u32 | 4 | 411088 |
| 320 | `FavouriteCar` | u32 | 4 | 2740 |
| 321 | `TimeInCarChampionshipEvents` | u32 | 4 | 0 |
| 322 | `BiggestAir` | float32 | 4 | 10.6929 |
| 323 | `BeautySpotsDiscovered` | u32 | 4 | 0 |
| 324 | `OnlineKingGamesEntered` | u32 | 4 | 0 |
| 325 | `OnlineRoadTripDistanceDriven` | u32 | 4 | 6588759 |
| 326 | `OnlineInfectedGamesEntered` | u32 | 4 | 0 |
| 327 | `TotalLineUpFansEarned` | u32 | 4 | 0 |
| 328 | `TimeInShowcases` | u32 | 4 | 1032 |
| 329 | `FlagRushGamesEntered` | u32 | 4 | 0 |
| 330 | `MostSuccessfulCar` | u32 | 4 | 363 |
| 331 | `OnlinePodiumFinishes` | u32 | 4 | 675 |
| 332 | `LapsCompletedInRivals` | u32 | 4 | 2285 |
| 333 | `OnlineCumulativeFinishPos` | u32 | 4 | 3373 |
| 334 | `OnlineRoadTripLastWinDay` | u32 flag | 4 | 119 |
| 335 | `MostSuccessfulCarWins` | u32 | 4 | 125 |
| 336 | `TimeInRushEvents` | u32 | 4 | 4382 |
| 337 | `OnlineTimeSpentInCareerCoop` | u32 | 4 | 0 |
| 338 | `DriftZonesCompleted` | index / ref | 4 | 20 |
| 339 | `OnlineRacesEntered` | u32 | 4 | 1045 |
| 340 | `FavouriteRadioStation` | u32 | 4 | 6 |
| 341 | `CarChampionshipEventsRaced` | u32 | 4 | 1142 |
| 342 | `CarManufacturersOwned` | u32 | 4 | 90 |
| 343 | `OnlineCoopBucketlistEventsCompleted` | u32 | 4 | 0 |
| 344 | `TotalFansEarned` | u32 | 4 | 0 |
| 345 | `CarChampionshipEventPodiums` | u32 | 4 | 986 |
| 346 | `TotalLineUpCreditsEarned` | u32 | 4 | 0 |
| 347 | `TimesSpokenToAnna` | u32 | 4 | 0 |
| 348 | `OnlineEventsFinished` | u32 | 4 | 819 |
| 349 | `TimeInRaceEncounters` | u32 | 4 | 19129 |
| 350 | `DangerSignsCompleted` | index / ref | 4 | 20 |
| 351 | `CarChampionshipsCompleted` | u32 | 4 | 0 |
| 352 | `TotalCoOpFansEarned` | u32 | 4 | 0 |
| 353 | `OnlineStreetRacesEntered` | u32 | 4 | 36 |
| 354 | `RoadTripDistanceDriven` | u32 | 4 | 0 |
| 355 | `ShowcasesWonTotal` | u32 | 4 | 3 |
| 356 | `TimeInRoadTrips` | u32 | 4 | 0 |
| 357 | `TotalCoOpCreditsEarned` | u32 | 4 | 615576 |
| 358 | `LocationsDiscovered` | index / ref | 4 | 74 |
| 359 | `DrivatarLineupCount` | u32 | 4 | 0 |
| 360 | `OnlineRacesQuit` | u32 | 4 | 216 |
| 361 | `SpeedTrapsCompleted` | index / ref | 4 | 30 |
| 362 | `NumRacesSinglePlayer` | u32 | 4 | 327 |
| 363 | `OnlineTeamRacesWon` | u32 | 4 | 47 |
| 364 | `TrailBlazersCompleted` | index / ref | 4 | 11 |
| 365 | `TotalCoOpXpEarned` | u32 | 4 | 425067 |
| 366 | **Options** | GROUP (payload = child count) | 4 | 199 children |
| 367 | `ScreenReaderSpeed` | float32 | 4 | 0.5 |
| 368 | `Crossplay` | bool (1 B) | 1 | 1 |
| 369 | `ProximityRadarBackground` | bool / small enum (1 B) | 1 | 1 |
| 370 | `Ghosts` | u32 flag | 4 | 1 |
| 371 | `Streaming_MiniLeaderboardDefaultMode` | u32 flag | 4 | 0 |
| 372 | `Streaming_MovingBackgrounds` | bool (1 B) | 1 | 1 |
| 373 | `MiniLeaderboardDefaultMode` | u32 flag | 4 | 0 |
| 374 | `MovingBackgrounds` | bool (1 B) | 1 | 1 |
| 375 | `MinorNotifications` | u32 flag | 4 | 1 |
| 376 | `Streaming_Speedometer` | u32 flag | 4 | 1 |
| 377 | `Streaming_ScreenReaderSpeed` | float32 | 4 | 0.5 |
| 378 | `Streaming_HighContrastFillAICar` | bool / small enum (1 B) | 1 | 0 |
| 379 | `Streaming_HighContrastModeCollectibles` | bool / small enum (1 B) | 1 | 1 |
| 380 | `Streaming_TelemetryDataOutPort` | var-length | 4 |  |
| 381 | `Streaming_HighContrastModeEventChevrons` | bool / small enum (1 B) | 1 | 1 |
| 382 | `Units` | u32 flag | 4 | 0 |
| 383 | `Streaming_ProximityRadarBackground` | bool / small enum (1 B) | 1 | 0 |
| 384 | `HighContrastFillPlayerCar` | bool / small enum (1 B) | 1 | 0 |
| 385 | `ScreenReaderRacePositionLap` | bool / small enum (1 B) | 1 | 0 |
| 386 | `Streaming_HorizonPromoCarLabel` | u32 flag | 4 | 1 |
| 387 | `Convertible` | u32 flag | 4 | 1 |
| 388 | `Streaming_HighContrastFillEventChevrons` | bool / small enum (1 B) | 1 | 0 |
| 389 | `Streaming_StoryProgress` | bool (1 B) | 1 | 0 |
| 390 | `Streaming_TimeSplits` | u32 flag | 4 | 2 |
| 391 | `Streaming_TelemetryDataOutAddress` | var-length | 4 |  |
| 392 | `ConvoyInviteNotifications` | u32 flag | 4 | 1 |
| 393 | `DriftHeadMotion` | u32 flag | 4 | 0 |
| 394 | `HighContrastFillTrees` | bool / small enum (1 B) | 1 | 0 |
| 395 | `Streaming_PowerUnits` | u32 flag | 4 | 4294967295 |
| 396 | `Timers` | u32 flag | 4 | 1 |
| 397 | `Streaming_HighContrastFillSky` | bool / small enum (1 B) | 1 | 0 |
| 398 | `Streaming_ConvoyInviteNotifications` | u32 flag | 4 | 1 |
| 399 | `HighContrastModeImprovedNightVisibility` | bool / small enum (1 B) | 1 | 0 |
| 400 | `UIMotionBlurEnabled` | bool (1 B) | 1 | 0 |
| 401 | `Streaming_AccoladeNotifications` | u32 flag | 4 | 1 |
| 402 | `HighContrastModeAICar` | bool / small enum (1 B) | 1 | 1 |
| 403 | `Streaming_HighContrastFillPlayerCar` | bool / small enum (1 B) | 1 | 0 |
| 404 | `Streaming_UITextScalingFactor` | float32 | 4 | 1.0 |
| 405 | `ShowLeaderboardTimesForAllPlatforms` | u32 flag | 4 | 1 |
| 406 | `AheadBehindLabels` | u32 flag | 4 | 1 |
| 407 | `Streaming_ScreenReaderRacePositionChange` | bool / small enum (1 B) | 1 | 0 |
| 408 | `Streaming_HideInactiveMouseOnHUD` | u32 flag | 4 | 1 |
| 409 | `Streaming_HUDRallyCallCards` | bool (1 B) | 1 | 1 |
| 410 | `HighContrastModeEventBarriers` | bool / small enum (1 B) | 1 | 1 |
| 411 | `Streaming_MinorNotifications` | u32 flag | 4 | 1 |
| 412 | `Streaming_screenReaderRacePositionChangeDelay` | float32 | 4 | 0.0 |
| 413 | `HorizonPromoCarLabel` | u32 flag | 4 | 1 |
| 414 | `HighContrastFillEventBarriers` | bool / small enum (1 B) | 1 | 0 |
| 415 | `Streaming_SpringUnits` | u32 flag | 4 | 4294967295 |
| 416 | `TelemetryDataOutPort` | var-length | 8 |  |
| 417 | `QuickChat` | u32 flag | 4 | 1 |
| 418 | `Streaming_DriftHeadMotionStrength` | u32 flag | 4 | 50 |
| 419 | `Streaming_HighContrastModeTrees` | bool / small enum (1 B) | 1 | 1 |
| 420 | `Streaming_DriftHeadMotion` | u32 flag | 4 | 0 |
| 421 | `HUDRallyCallCards` | bool (1 B) | 1 | 1 |
| 422 | `HighContrastFillCheckpoints` | bool / small enum (1 B) | 1 | 0 |
| 423 | `HUDSafeFrameHorizontal` | float32 | 4 | 0.05 |
| 424 | `Streaming_QuickChat` | u32 flag | 4 | 1 |
| 425 | `Streaming_Handheld_UITextScalingEnabled` | bool (1 B) | 1 | 1 |
| 426 | `Handheld_UITextScalingFactor` | float32 | 4 | 1.25 |
| 427 | `Streaming_HighContrastFillPRStunts` | bool / small enum (1 B) | 1 | 0 |
| 428 | `Streaming_HUDReticle` | bool (1 B) | 1 | 1 |
| 429 | `Speedometer` | u32 flag | 4 | 2 |
| 430 | `HighContrastFillRacingLineSlow` | bool / small enum (1 B) | 1 | 0 |
| 431 | `Streaming_Ghosts` | u32 flag | 4 | 1 |
| 432 | `HighContrastModePlayerCar` | bool / small enum (1 B) | 1 | 1 |
| 433 | `Streaming_NotificationDurationsMultiplier` | float32 | 4 | 1.0 |
| 434 | `HighContrastFillPRStunts` | bool / small enum (1 B) | 1 | 0 |
| 435 | `HighContrastModeSky` | bool / small enum (1 B) | 1 | 1 |
| 436 | `ScreenReaderRouteProgress` | bool / small enum (1 B) | 1 | 0 |
| 437 | `Streaming_HighContrastModeRacingLineBrake` | bool / small enum (1 B) | 1 | 1 |
| 438 | `Streaming_HighContrastModeRacingLineSlow` | bool / small enum (1 B) | 1 | 1 |
| 439 | `Streaming_HighContrastFillCollectibles` | bool / small enum (1 B) | 1 | 0 |
| 440 | `ActivityInviteNotifications` | u32 flag | 4 | 1 |
| 441 | `NamesOverCars` | u32 flag | 4 | 1 |
| 442 | `Streaming_Convertible` | u32 flag | 4 | 1 |
| 443 | `ScreenReaderVoiceXbox` | var-length | 4 |  |
| 444 | `Streaming_ProximityAudioEnabled` | bool / small enum (1 B) | 1 | 0 |
| 445 | `Streaming_ScreenReaderRouteProgress` | bool / small enum (1 B) | 1 | 0 |
| 446 | `Streaming_Units` | u32 flag | 4 | 0 |
| 447 | `Streaming_Timers` | u32 flag | 4 | 1 |
| 448 | `Streaming_HUDSafeFrameHorizontal` | float32 | 4 | 0.052 |
| 449 | `HighContrastFillTerrain` | bool / small enum (1 B) | 1 | 0 |
| 450 | `Streaming_Map` | u32 flag | 4 | 1 |
| 451 | `Streaming_HighContrastModePlayerCar` | bool / small enum (1 B) | 1 | 3 |
| 452 | `Streaming_Crossplay` | bool (1 B) | 1 | 1 |
| 453 | `Streaming_ProximityRadarEnabled` | bool / small enum (1 B) | 1 | 0 |
| 454 | `HighContrastModeEnabled` | bool / small enum (1 B) | 1 | 0 |
| 455 | `Streaming_RaceEncountersAcceptChallenge` | bool (1 B) | 1 | 1 |
| 456 | `NotificationDurationsMultiplier` | float32 | 4 | 1.0 |
| 457 | `HighContrastModeTerrain` | bool / small enum (1 B) | 1 | 1 |
| 458 | `DamageTireWear` | u32 flag | 4 | 1 |
| 459 | `SpringUnits` | u32 flag | 4 | 4294967295 |
| 460 | `HighContrastModeRacingLineBrake` | bool / small enum (1 B) | 1 | 4 |
| 461 | `HighContrastModeCheckpoints` | bool / small enum (1 B) | 1 | 1 |
| 462 | `HideInactiveMouseOnHUD` | u32 flag | 4 | 1 |
| 463 | `HighContrastModeEventChevrons` | bool / small enum (1 B) | 1 | 1 |
| 464 | `HighContrastFillEventChevrons` | bool / small enum (1 B) | 1 | 0 |
| 465 | `HighContrastModeRacingLineSlow` | bool / small enum (1 B) | 1 | 2 |
| 466 | `HUDReticle` | bool (1 B) | 1 | 1 |
| 467 | `Streaming_ScreenReaderLaps` | bool / small enum (1 B) | 1 | 0 |
| 468 | `AccoladeNotifications` | u32 flag | 4 | 1 |
| 469 | `Streaming_HighContrastModeAICar` | bool / small enum (1 B) | 1 | 1 |
| 470 | `Streaming_ScreenReaderRacePositionLap` | bool / small enum (1 B) | 1 | 0 |
| 471 | `HighContrastModeRacingLine` | bool / small enum (1 B) | 1 | 1 |
| 472 | `Streaming_EnablePlayerLiveries` | u32 flag | 4 | 1 |
| 473 | `Streaming_HighContrastModeRacingLine` | bool / small enum (1 B) | 1 | 1 |
| 474 | `ScreenReaderPitch` | float32 | 4 | 0.5 |
| 475 | `Streaming_HighContrastFillRacingLineSlow` | bool / small enum (1 B) | 1 | 0 |
| 476 | `HighContrastModeTrees` | bool / small enum (1 B) | 1 | 1 |
| 477 | `Streaming_ScreenReaderPitch` | float32 | 4 | 0.5 |
| 478 | `UITextScalingEnabled` | bool (1 B) | 1 | 0 |
| 479 | `HighContrastFillRaceGantry` | bool / small enum (1 B) | 1 | 0 |
| 480 | `HUDSafeFrameVertical` | float32 | 4 | 0.093 |
| 481 | `Streaming_EnableFriendRequestHud` | bool (1 B) | 1 | 1 |
| 482 | `ForzathonNotifications` | u32 flag | 4 | 1 |
| 483 | `Streaming_HighContrastFillRaceGantry` | bool / small enum (1 B) | 1 | 0 |
| 484 | `Streaming_LensEffects` | u32 flag | 4 | 1 |
| 485 | `Streaming_HighContrastModeEventBarriers` | bool / small enum (1 B) | 1 | 1 |
| 486 | `Streaming_HighContrastFillCheckpoints` | bool / small enum (1 B) | 1 | 0 |
| 487 | `Streaming_HighContrastModeEnabled` | bool / small enum (1 B) | 1 | 0 |
| 488 | `Streaming_HighContrastModeTerrain` | bool / small enum (1 B) | 1 | 0 |
| 489 | `Streaming_HighContrastFillEventBarriers` | bool / small enum (1 B) | 1 | 0 |
| 490 | `HighContrastModeRaceGantry` | bool / small enum (1 B) | 1 | 1 |
| 491 | `EnablePlayerLiveries` | u32 flag | 4 | 1 |
| 492 | `HighContrastFillCollectibles` | bool / small enum (1 B) | 1 | 0 |
| 493 | `Streaming_ScreenReaderVoiceWindows` | var-length | 4 |  |
| 494 | `Streaming_HighContrastModeRaceGantry` | bool / small enum (1 B) | 1 | 1 |
| 495 | `Streaming_Anna` | u32 flag | 4 | 1 |
| 496 | `EnableDrivatarLiveries` | u32 flag | 4 | 1 |
| 497 | `Streaming_HighContrastFillTerrain` | bool / small enum (1 B) | 1 | 0 |
| 498 | `HighContrastFillAICar` | bool / small enum (1 B) | 1 | 0 |
| 499 | `screenReaderRacePositionChangeDelay` | float32 | 4 | 0.0 |
| 500 | `Streaming_Handheld_UITextScalingFactor` | float32 | 4 | 1.25 |
| 501 | `Streaming_ProximityRadarPosition` | bool / small enum (1 B) | 1 | 0 |
| 502 | `Streaming_HighContrastModeSky` | bool / small enum (1 B) | 1 | 1 |
| 503 | `TelemetryDataOut` | bool / small enum (1 B) | 1 | 1 |
| 504 | `Streaming_RaceFeats` | u32 flag | 4 | 1 |
| 505 | `Streaming_PauseOnFocusLost` | bool (1 B) | 1 | 1 |
| 506 | `Streaming_CameraAngle` | u32 flag | 4 | 0 |
| 507 | `ScreenReaderVoiceWindows` | var-length | 4 |  |
| 508 | `HighContrastFillRacingLine` | bool / small enum (1 B) | 1 | 0 |
| 509 | `Streaming_HUDSafeFrameVertical` | float32 | 4 | 0.093 |
| 510 | `StoryProgress` | bool (1 B) | 1 | 0 |
| 511 | `Streaming_UITextScalingEnabled` | bool (1 B) | 1 | 0 |
| 512 | `Streaming_HighContrastFillTrees` | bool / small enum (1 B) | 1 | 0 |
| 513 | `Streaming_HighContrastFillRacingLine` | bool / small enum (1 B) | 1 | 0 |
| 514 | `Streaming_HighContrastModeImprovedNightVisibility` | bool / small enum (1 B) | 1 | 0 |
| 515 | `Streaming_HighContrastFillRoad` | bool / small enum (1 B) | 1 | 0 |
| 516 | `Streaming_TelemetryDataOut` | bool / small enum (1 B) | 1 | 0 |
| 517 | `HighContrastFillSky` | bool / small enum (1 B) | 1 | 0 |
| 518 | `RaceFeats` | u32 flag | 4 | 1 |
| 519 | `Streaming_HighContrastModePRStunts` | bool / small enum (1 B) | 1 | 1 |
| 520 | `PauseOnFocusLost` | bool (1 B) | 1 | 0 |
| 521 | `Streaming_ScreenReaderVoiceXbox` | var-length | 4 |  |
| 522 | `Telemetry` | u32 flag | 4 | 2 |
| 523 | `ProximityAudioEnabled` | bool / small enum (1 B) | 1 | 0 |
| 524 | `Streaming_ActivityInviteNotifications` | u32 flag | 4 | 1 |
| 525 | `TelemetryDataOutAddress` | var-length | 13 |  |
| 526 | `EnableFriendRequestHud` | bool (1 B) | 1 | 1 |
| 527 | `HighContrastFillTrafficCar` | bool / small enum (1 B) | 1 | 0 |
| 528 | `Streaming_UIMotionBlurEnabled` | bool (1 B) | 1 | 1 |
| 529 | `Streaming_HighContrastModeRoad` | bool / small enum (1 B) | 1 | 2 |
| 530 | `UITextScalingFactor` | float32 | 4 | 1.0 |
| 531 | `Streaming_HighContrastFillTrafficCar` | bool / small enum (1 B) | 1 | 0 |
| 532 | `Streaming_ForzathonNotifications` | u32 flag | 4 | 1 |
| 533 | `LensEffects` | u32 flag | 4 | 1 |
| 534 | `HighContrastModePRStunts` | bool / small enum (1 B) | 1 | 1 |
| 535 | `Streaming_DriftHeadMotionRange` | u32 flag | 4 | 100 |
| 536 | `Mirror` | u32 flag | 4 | 1 |
| 537 | `Handheld_UITextScalingEnabled` | bool (1 B) | 1 | 1 |
| 538 | `DriftHud` | u32 flag | 4 | 0 |
| 539 | `Streaming_HighContrastFillRacingLineBrake` | bool / small enum (1 B) | 1 | 0 |
| 540 | `ProximityRadarEnabled` | bool / small enum (1 B) | 1 | 2 |
| 541 | `CameraEffects` | u32 flag | 4 | 1 |
| 542 | `TimeSplits` | u32 flag | 4 | 2 |
| 543 | `ProximityRadarPosition` | bool / small enum (1 B) | 1 | 5 |
| 544 | `HighContrastModeCollectibles` | bool / small enum (1 B) | 1 | 1 |
| 545 | `Streaming_WrongWay` | u32 flag | 4 | 1 |
| 546 | `Anna` | u32 flag | 4 | 1 |
| 547 | `PowerUnits` | u32 flag | 4 | 4294967295 |
| 548 | `DriftHeadMotionStrength` | u32 flag | 4 | 50 |
| 549 | `Streaming_HighContrastModeCheckpoints` | bool / small enum (1 B) | 1 | 5 |
| 550 | `HighContrastFillRoad` | bool / small enum (1 B) | 1 | 0 |
| 551 | `RaceEncountersAcceptChallenge` | bool (1 B) | 1 | 1 |
| 552 | `HighContrastModeRoad` | bool / small enum (1 B) | 1 | 1 |
| 553 | `DriftHeadMotionLookSpeed` | u32 flag | 4 | 25 |
| 554 | `Map` | u32 flag | 4 | 1 |
| 555 | `DriftHeadMotionRange` | u32 flag | 4 | 100 |
| 556 | `WrongWay` | u32 flag | 4 | 1 |
| 557 | `CameraAngle` | u32 flag | 4 | 1 |
| 558 | `HighContrastModeTrafficCar` | bool / small enum (1 B) | 1 | 1 |
| 559 | `ScreenReaderLaps` | bool / small enum (1 B) | 1 | 0 |
| 560 | `Streaming_HighContrastModeTrafficCar` | bool / small enum (1 B) | 1 | 1 |
| 561 | `Streaming_NamesOverCars` | u32 flag | 4 | 1 |
| 562 | `ScreenReaderRacePositionChange` | bool / small enum (1 B) | 1 | 0 |
| 563 | `Streaming_EnableDrivatarLiveries` | u32 flag | 4 | 1 |
| 564 | `HighContrastFillRacingLineBrake` | bool / small enum (1 B) | 1 | 0 |
| 565 | `Streaming_DriftHeadMotionLookSpeed` | u32 flag | 4 | 25 |
| 566 | **WheelOptions** | GROUP (payload = child count) | 4 | 8 children |
| 567 | `RewindOnBack` | u32 flag | 4 | 0 |
| 568 | `RumbleSetting` | u32 flag | 4 | 1 |
| 569 | `InvertHandbrakeClutch` | u32 flag | 4 | 0 |
| 570 | `Layout` | u32 flag | 4 | 0 |
| 571 | `InvertAnnaTelemetry` | u32 flag | 4 | 0 |
| 572 | `InvertGearUpDown` | u32 flag | 4 | 0 |
| 573 | `InvertCameraLookBack` | u32 flag | 4 | 0 |
| 574 | `InvertHornPhotoMode` | u32 flag | 4 | 0 |
| 575 | **BristolAdvancedOptions** | GROUP (payload = child count) | 4 | 20 children |
| 576 | `SteeringLinearity` | float32 | 4 | 0.5 |
| 577 | `WheelRotationAngle` | float32 | 4 | 900.0 |
| 578 | `WheelDamperScale` | float32 | 4 | 1.0 |
| 579 | `RumbleScale` | float32 | 4 | 1.0 |
| 580 | `SteeringLockRatio` | float32 | 4 | 1.0 |
| 581 | `HandbrakeDeadzoneInside` | float32 | 4 | 1.0 |
| 582 | `ThrottleDeadzoneOutside` | float32 | 4 | 1.0 |
| 583 | `SteeringAxisDeadzoneOutside` | float32 | 4 | 0.95 |
| 584 | `HandbrakeDeadzoneOutside` | float32 | 4 | 0.0 |
| 585 | `SteeringRotation` | float32 | 4 | -1.0 |
| 586 | `ClutchDeadzoneInside` | float32 | 4 | 1.0 |
| 587 | `ClutchDeadzoneOutside` | float32 | 4 | 1.0 |
| 588 | `SteeringSensitivity` | float32 | 4 | 0.5 |
| 589 | `ForceFeedbackInvert` | bool (1 B) | 1 | 0 |
| 590 | `SteeringAxisDeadzoneInside` | float32 | 4 | 0.01 |
| 591 | `BrakeDeadzoneInside` | float32 | 4 | 0.15 |
| 592 | `CenterSpringScale` | float32 | 4 | 1.0 |
| 593 | `BrakeDeadzoneOutside` | float32 | 4 | 900.0 |
| 594 | `ThrottleDeadzoneInside` | float32 | 4 | 0.15 |
| 595 | `SteeringSpeedSensitivity` | float32 | 4 | 1.0 |
| 596 | **RawGameControllerOptions** | GROUP (payload = child count) | 4 | 8 children |
| 597 | `RewindOnBack` | u32 flag | 4 | 0 |
| 598 | `RumbleSetting` | u32 flag | 4 | 1 |
| 599 | `InvertHandbrakeClutch` | u32 flag | 4 | 0 |
| 600 | `Layout` | u32 flag | 4 | 0 |
| 601 | `InvertAnnaTelemetry` | u32 flag | 4 | 0 |
| 602 | `InvertGearUpDown` | u32 flag | 4 | 0 |
| 603 | `InvertCameraLookBack` | u32 flag | 4 | 0 |
| 604 | `InvertHornPhotoMode` | u32 flag | 4 | 0 |
| 605 | **RawGameControllerAdvancedOptions** | GROUP (payload = child count) | 4 | 17 children |
| 606 | `SteeringLinearity` | float32 | 4 | 0.5 |
| 607 | `WheelRotationAngle` | float32 | 4 | 900.0 |
| 608 | `WheelDamperScale` | float32 | 4 | 1.0 |
| 609 | `RumbleScale` | float32 | 4 | 1.0 |
| 610 | `SteeringLockRatio` | float32 | 4 | 1.0 |
| 611 | `ForceFeedbackScale` | float32 | 4 | 1.0 |
| 612 | `ForceFeedbackUndersteerFactor` | float32 | 4 | 1.0 |
| 613 | `ForceFeedbackOffroadFeelFactor` | float32 | 4 | 1.0 |
| 614 | `ForceFeedbackMaxLateralForceFactor` | float32 | 4 | 1.0 |
| 615 | `UseGamepadSteeringFilters` | bool (1 B) | 1 | 0 |
| 616 | `ForceFeedbackLinearityFactor` | float32 | 4 | 1.0 |
| 617 | `SteeringRotation` | float32 | 4 | -1.0 |
| 618 | `SteeringSensitivity` | float32 | 4 | 0.5 |
| 619 | `ForceFeedbackInvert` | bool (1 B) | 1 | 0 |
| 620 | `ForceFeedbackRoadFeelFactor` | float32 | 4 | 1.0 |
| 621 | `CenterSpringScale` | float32 | 4 | 1.0 |
| 622 | `SteeringSpeedSensitivity` | float32 | 4 | 1.0 |
| 623 | **ControllerAdvancedOptions** | GROUP (payload = child count) | 4 | 26 children |
| 624 | `SteeringLinearity` | float32 | 4 | 0.71 |
| 625 | `WheelRotationAngle` | float32 | 4 | 900.0 |
| 626 | `WheelDamperScale` | float32 | 4 | 1.0 |
| 627 | `RumbleScale` | float32 | 4 | 0.5 |
| 628 | `SteeringLockRatio` | float32 | 4 | 1.0 |
| 629 | `ForceFeedbackScale` | float32 | 4 | 1.0 |
| 630 | `ForceFeedbackUndersteerFactor` | float32 | 4 | 1.0 |
| 631 | `HandbrakeDeadzoneInside` | float32 | 4 | 0.18 |
| 632 | `ThrottleDeadzoneOutside` | float32 | 4 | 0.9 |
| 633 | `ForceFeedbackOffroadFeelFactor` | float32 | 4 | 1.0 |
| 634 | `SteeringAxisDeadzoneOutside` | float32 | 4 | 0.9 |
| 635 | `ForceFeedbackMaxLateralForceFactor` | float32 | 4 | 1.0 |
| 636 | `ForceFeedbackLinearityFactor` | float32 | 4 | 1.0 |
| 637 | `HandbrakeDeadzoneOutside` | float32 | 4 | 1.0 |
| 638 | `SteeringRotation` | float32 | 4 | -1.0 |
| 639 | `ClutchDeadzoneInside` | float32 | 4 | 0.1 |
| 640 | `ClutchDeadzoneOutside` | float32 | 4 | 1.0 |
| 641 | `SteeringSensitivity` | float32 | 4 | 0.5 |
| 642 | `ForceFeedbackInvert` | bool (1 B) | 1 | 0 |
| 643 | `SteeringAxisDeadzoneInside` | float32 | 4 | 0.23 |
| 644 | `ForceFeedbackRoadFeelFactor` | float32 | 4 | 1.0 |
| 645 | `BrakeDeadzoneInside` | float32 | 4 | 0.0 |
| 646 | `CenterSpringScale` | float32 | 4 | 1.0 |
| 647 | `BrakeDeadzoneOutside` | float32 | 4 | 0.8 |
| 648 | `ThrottleDeadzoneInside` | float32 | 4 | 0.0 |
| 649 | `SteeringSpeedSensitivity` | float32 | 4 | 1.0 |
| 650 | **CompareStats** | GROUP (payload = child count) | 4 | 57 children |
| 651 | `BarnFinds` | index / ref | 4 | 15 |
| 652 | `RivalsBeaten` | u32 | 4 | 207 |
| 653 | `RaceEncountersEntered` | u32 | 4 | 214 |
| 654 | `DriftZonesTriggered` | u32 | 4 | 20 |
| 655 | `CarChampionshipEventsWon` | u32 | 4 | 603 |
| 656 | `HorizonFinalProgress` | u32 | 4 | 0 |
| 657 | `ShowcasesWon` | index / ref | 4 | 2 |
| 658 | `OnlineTimeSpentNotAsKing` | u32 | 4 | 0 |
| 659 | `DangerSignsTriggered` | u32 | 4 | 20 |
| 660 | `ProgressToFinalShowcase` | u32 | 4 | 0 |
| 661 | `OnlineTimesInfected` | u32 | 4 | 0 |
| 662 | `RaceEncountersWon` | u32 | 4 | 70 |
| 663 | `CarsInGarage` | u32 | 4 | 815 |
| 664 | `OnlineRacesWon` | u32 | 4 | 305 |
| 665 | `NumCleanOvertakes` | u32 | 4 | 2837 |
| 666 | `OnlineRoadTripDestsCompleted` | u32 | 4 | 296 |
| 667 | `DiscountBoardsSmashed` | index / ref | 4 | 200 |
| 668 | `WristbandLevel` | u32 | 4 | 19617672 |
| 669 | `RoadsDiscovered` | index / ref | 4 | 671 |
| 670 | `DestinationsVisited` | u32 | 4 | 0 |
| 671 | `NumberOfFlagsStolenFromYou` | u32 | 4 | 0 |
| 672 | `RoadTripEventsCompleted` | u32 | 4 | 0 |
| 673 | `RoadTripPartiesAttended` | u32 | 4 | 0 |
| 674 | `TrailBlazersTriggered` | u32 | 4 | 11 |
| 675 | `CampaignSlotExhibitionsCompleted` | index / ref | 4 | 92 |
| 676 | `NumberOfFlagsDeniedByYou` | u32 | 4 | 0 |
| 677 | `SpeedTrapsTriggered` | u32 | 4 | 30 |
| 678 | `CreditsEarnedFromRivals` | u32 | 4 | 3937263 |
| 679 | `OnlineXP` | u32 | 4 | 4737967 |
| 680 | `GarageValue` | u32 | 4 | 680713090 |
| 681 | `MediumValueBoardsSmashed` | index / ref | 4 | 75 |
| 682 | `OnlineInfectedGamesWon` | u32 | 4 | 0 |
| 683 | `CarMeetsDiscovered` | u32 | 4 | 0 |
| 684 | `CampaignSlotChampionshipsCompleted` | index / ref | 4 | 1 |
| 685 | `OnlineTimesYouInfectedOthers` | u32 | 4 | 0 |
| 686 | `FlagRushGamesWon` | u32 | 4 | 0 |
| 687 | `SpeedZonesTriggered` | u32 | 4 | 30 |
| 688 | `SmallValueBoardsSmashed` | index / ref | 4 | 100 |
| 689 | `HighestNumCollisionsInRace` | u32 | 4 | 179 |
| 690 | `XPEarnedInRoadTrips` | u32 | 4 | 0 |
| 691 | `CarChampionshipsWon` | u32 | 4 | 0 |
| 692 | `OnlineHighestXPWonInAnEvent` | u32 | 4 | 30097 |
| 693 | `PerksUnlocked` | index / ref | 4 | 16 |
| 694 | `HighValueBoardsSmashed` | index / ref | 4 | 25 |
| 695 | `OnlineTimeSpentAsKing` | u32 | 4 | 0 |
| 696 | `BucketlistEventsCompleted` | index / ref | 4 | 0 |
| 697 | `PhotoChallengesCompleted` | u32 | 4 | 0 |
| 698 | `OnlineNumCleanOvertakes` | u32 | 4 | 1692 |
| 699 | `OnlineLongestRoadTrip` | u32 | 4 | 69 |
| 700 | `NumberOfFlagsCaptured` | u32 | 4 | 0 |
| 701 | `HighestXPWinInAnEvent` | u32 | 4 | 33148 |
| 702 | `CleanLaps` | u32 | 4 | 641 |
| 703 | `OnlineWinnings` | u32 | 4 | 5468621 |
| 704 | `HorizonFinalProgress2` | u32 | 4 | 0 |
| 705 | `ShowcasesEntered` | u32 | 4 | 4 |
| 706 | `TimeInFirstPlace` | u32 | 4 | 314246 |
| 707 | `OnlineKingGamesWon` | u32 | 4 | 0 |
| 708 | `V6` | u64 | 8 | 0 |
| 709 | `V5` | u64 | 8 | 0 |
| 710 | `V4` | u64 | 8 | 0 |
| 711 | `V3` | u64 | 8 | 258240594865 |
| 712 | `V2` | u64 | 8 | 3487986016734552085 |
| 713 | `V1` | u64 | 8 | 7426844265993109755 |
| 714 | `V0` | u64 | 1224 | 9068547356416278529 |

## 2. The embedded SQLite career database

Carve from the `SQLite format 3` magic to EOF; the header's page count is 0, so open it by file size.

| table | rows | columns |
| --- | ---: | ---: |
| [`BarnFinds`](#barnfinds) | 15 | 3 |
| [`CarExperienceUnlocks`](#carexperienceunlocks) | 4 | 1 |
| [`CareerRaceCollections`](#careerracecollections) | 0 | 9 |
| [`CareerRaces`](#careerraces) | 0 | 59 |
| [`CareerRacesInCollection`](#careerracesincollection) | 0 | 3 |
| [`Career_Garage`](#careergarage) | 815 | 146 |
| [`Career_PurchasedParts`](#careerpurchasedparts) | 8,019 | 4 |
| [`FreeCars`](#freecars) | 0 | 2 |
| [`PhotoCaptures`](#photocaptures) | 481 | 1 |

### `BarnFinds`

15 rows × 3 columns.

| column | type | key | populated |
| --- | --- | --- | --- |
| `CarOrdinal` | INTEGER | pk | 15 / 15 |
| `State` | INT |  | 15 / 15 |
| `VIN` | TEXT |  | 15 / 15 |

### `CarExperienceUnlocks`

4 rows × 1 columns.

| column | type | key | populated |
| --- | --- | --- | --- |
| `CarID` | INTEGER | pk | 4 / 4 |

### `CareerRaceCollections`

0 rows × 9 columns. Empty in this capture — the schema exists, nothing populates it.

| column | type | key | populated |
| --- | --- | --- | --- |
| `CareerRaceCollectionId` | INTEGER | pk | — |
| `Name` | TEXT |  | — |
| `Description` | TEXT |  | — |
| `CreatorXUID` | BIGINT |  | — |
| `CareerRaceCollectionTypeId` | INT |  | — |
| `CarRestrictions` | TEXT |  | — |
| `HorizonSpecialTypeId` | INT |  | — |
| `RandomNumberSeed` | INT |  | — |
| `FlyerContainerName` | TEXT |  | — |

### `CareerRaces`

0 rows × 59 columns. Empty in this capture — the schema exists, nothing populates it.

| column | type | key | populated |
| --- | --- | --- | --- |
| `CareerRaceId` | INTEGER | pk | — |
| `Name` | TEXT |  | — |
| `CareerEventTypeId` | INT |  | — |
| `TrackId` | INT |  | — |
| `RaceModeId` | INT |  | — |
| `NumLaps` | INT |  | — |
| `CustomRoute` | INT |  | — |
| `RouteContainerName` | TEXT |  | — |
| `CustomRouteP2P` | INT |  | — |
| `NumberOfAIDrivers` | INT |  | — |
| `SpringCustomWeather` | INT |  | — |
| `SpringWeatherPresetId` | INT |  | — |
| `SpringPauseWeather` | INT |  | — |
| `SpringUseRegionalWeather` | INT |  | — |
| `SummerCustomWeather` | INT |  | — |
| `SummerWeatherPresetId` | INT |  | — |
| `SummerPauseWeather` | INT |  | — |
| `SummerUseRegionalWeather` | INT |  | — |
| `AutumnCustomWeather` | INT |  | — |
| `AutumnWeatherPresetId` | INT |  | — |
| `AutumnPauseWeather` | INT |  | — |
| `AutumnUseRegionalWeather` | INT |  | — |
| `WinterCustomWeather` | INT |  | — |
| `WinterWeatherPresetId` | INT |  | — |
| `WinterPauseWeather` | INT |  | — |
| `WinterUseRegionalWeather` | INT |  | — |
| `DifficultyMin` | REAL |  | — |
| `DifficultyMax` | REAL |  | — |
| `LoadBackToStart` | INT |  | — |
| `TeamsEnabled` | INT |  | — |
| `CollisionsEnabled` | INT |  | — |
| `DurationInSeconds` | INT |  | — |
| `HardcoreMode` | INT |  | — |
| `Radio1TrackInt` | INT |  | — |
| `Radio2TrackInt` | INT |  | — |
| `Radio3TrackInt` | INT |  | — |
| `Radio4TrackInt` | INT |  | — |
| `Radio5TrackInt` | INT |  | — |
| `Radio6TrackInt` | INT |  | — |
| `Radio7TrackInt` | INT |  | — |
| `Radio8TrackInt` | INT |  | — |
| `Radio9TrackInt` | INT |  | — |
| `Radio10TrackInt` | INT |  | — |
| `Radio11TrackInt` | INT |  | — |
| `StaggeredStart` | INT |  | — |
| `ForcedSeason` | INT |  | — |
| `RuleContainerName` | TEXT |  | — |
| `HasProps` | INT |  | — |
| `ArenaEvent` | INT |  | — |
| `EventLabEvent` | INT |  | — |
| `ForcedAIDifficulty` | INT |  | — |
| `IsRewindAvailable` | INT |  | — |
| `KeywordOneID` | INT |  | — |
| `KeywordTwoID` | INT |  | — |
| `ForcedCamera` | INT |  | — |
| `IsTimedEvent` | INT |  | — |
| `HasTraffic` | INT |  | — |
| `HasHelicopter` | INT |  | — |
| `HasRallyTimer` | INT |  | — |

### `CareerRacesInCollection`

0 rows × 3 columns. Empty in this capture — the schema exists, nothing populates it.

| column | type | key | populated |
| --- | --- | --- | --- |
| `CareerRacesInCollectionId` | INTEGER | pk | — |
| `CareerRaceCollectionId` | INT |  | — |
| `CareerRaceId` | INT |  | — |

### `Career_Garage`

815 rows × 146 columns.

| column | type | key | populated |
| --- | --- | --- | --- |
| `Id` | INTEGER | pk | 815 / 815 |
| `CarId` | INT |  | 815 / 815 |
| `PerformanceIndex` | REAL |  | 815 / 815 |
| `ClassID` | INT |  | 815 / 815 |
| `PartsValue` | INT |  | 815 / 815 |
| `SpeedRating` | REAL |  | 815 / 815 |
| `OffroadRating` | REAL |  | 815 / 815 |
| `AccelerationRating` | REAL |  | 815 / 815 |
| `LaunchRating` | REAL |  | 815 / 815 |
| `BrakingRating` | REAL |  | 815 / 815 |
| `HandlingRating` | REAL |  | 815 / 815 |
| `CurbWeight` | REAL |  | 815 / 815 |
| `WeightDistribution` | REAL |  | 815 / 815 |
| `AspirationTypeId` | INT |  | 815 / 815 |
| `SimPeakPower` | REAL |  | 815 / 815 |
| `SimPeakAngVel` | REAL |  | 815 / 815 |
| `SimPeakTorque` | REAL |  | 815 / 815 |
| `SimPeakTorqueAngVel` | REAL |  | 815 / 815 |
| `SimRedlineAngVel` | REAL |  | 815 / 815 |
| `PeakIntakePSI` | REAL |  | 815 / 815 |
| `TopSpeed` | REAL |  | 815 / 815 |
| `DistanceDriven` | INT |  | 815 / 815 |
| `TimeDriven` | INT |  | 815 / 815 |
| `TotalWinnings` | INT |  | 815 / 815 |
| `TotalRepairs` | INT |  | 815 / 815 |
| `NumVictories` | INT |  | 815 / 815 |
| `NumPodiums` | INT |  | 815 / 815 |
| `NumRaces` | INT |  | 815 / 815 |
| `NumOwners` | INT |  | 815 / 815 |
| `NumTimesSold` | INT |  | 815 / 815 |
| `TimeDrivenInRoadTrips` | INT |  | 815 / 815 |
| `CurOwnerNumRaces` | INT |  | 815 / 815 |
| `CurOwnerWinnings` | INT |  | 815 / 815 |
| `NumSkillPointsEarned` | INT |  | 815 / 815 |
| `HighestSkillScore` | INT |  | 815 / 815 |
| `OriginalOwner` | TEXT |  | 806 / 815 |
| `CarGroup` | INT |  | 0 / 815 |
| `Flags` | INT |  | 815 / 815 |
| `Engine` | INT |  | 815 / 815 |
| `Drivetrain` | INT |  | 815 / 815 |
| `CarBody` | INT |  | 815 / 815 |
| `Motor` | INT |  | 815 / 815 |
| `Brakes` | INT |  | 815 / 815 |
| `SpringDamper` | INT |  | 815 / 815 |
| `AntiSwayFront` | INT |  | 815 / 815 |
| `AntiSwayRear` | INT |  | 815 / 815 |
| `TireCompound` | INT |  | 815 / 815 |
| `RearWing` | INT |  | 815 / 815 |
| `RimSizeFront` | INT |  | 815 / 815 |
| `RimSizeRear` | INT |  | 815 / 815 |
| `Camshaft` | INT |  | 815 / 815 |
| `Valves` | INT |  | 815 / 815 |
| `Displacement` | INT |  | 815 / 815 |
| `PistonsCompression` | INT |  | 815 / 815 |
| `FuelSystem` | INT |  | 815 / 815 |
| `Ignition` | INT |  | 815 / 815 |
| `Exhaust` | INT |  | 815 / 815 |
| `Intake` | INT |  | 815 / 815 |
| `Flywheel` | INT |  | 815 / 815 |
| `Manifold` | INT |  | 815 / 815 |
| `RestrictorPlate` | INT |  | 815 / 815 |
| `OilCooling` | INT |  | 815 / 815 |
| `SingleTurbo` | INT |  | 815 / 815 |
| `TwinTurbo` | INT |  | 815 / 815 |
| `QuadTurbo` | INT |  | 815 / 815 |
| `SuperchargerCSC` | INT |  | 815 / 815 |
| `SuperchargerDSC` | INT |  | 815 / 815 |
| `Intercooler` | INT |  | 815 / 815 |
| `Clutch` | INT |  | 815 / 815 |
| `Transmission` | INT |  | 815 / 815 |
| `Driveline` | INT |  | 815 / 815 |
| `Differential` | INT |  | 815 / 815 |
| `FrontBumper` | INT |  | 815 / 815 |
| `RearBumper` | INT |  | 815 / 815 |
| `Hood` | INT |  | 815 / 815 |
| `SideSkirts` | INT |  | 815 / 815 |
| `TireWidthFront` | INT |  | 815 / 815 |
| `TireWidthRear` | INT |  | 815 / 815 |
| `WeightReduction` | INT |  | 815 / 815 |
| `ChassisStiffness` | INT |  | 815 / 815 |
| `TrackSpacingFront` | INT |  | 815 / 815 |
| `TrackSpacingRear` | INT |  | 815 / 815 |
| `FrontAspectRatio` | INT |  | 815 / 815 |
| `RearAspectRatio` | INT |  | 815 / 815 |
| `MotorParts` | INT |  | 815 / 815 |
| `TireBrand` | INT |  | 0 / 815 |
| `WheelStyle` | INT |  | 815 / 815 |
| `WheelStyleRear` | INT |  | 815 / 815 |
| `DefaultManufacturerColorIndex` | INT |  | 815 / 815 |
| `LiveryFileName` | TEXT |  | 424 / 815 |
| `TuneFileName` | TEXT |  | 238 / 815 |
| `VersionedTuneId` | TEXT |  | 815 / 815 |
| `VersionedTuneXUID` | BIGINT |  | 365 / 815 |
| `VersionedLiveryId` | TEXT |  | 815 / 815 |
| `Guid` | TEXT |  | 815 / 815 |
| `Thumbnail` | TEXT |  | 815 / 815 |
| `Tuning_frontTirePressure` | REAL |  | 815 / 815 |
| `Tuning_rearTirePressure` | REAL |  | 815 / 815 |
| `Tuning_finalDriveRatio` | REAL |  | 815 / 815 |
| `Tuning_firstGear` | REAL |  | 815 / 815 |
| `Tuning_secondGear` | REAL |  | 815 / 815 |
| `Tuning_thirdGear` | REAL |  | 815 / 815 |
| `Tuning_fourthGear` | REAL |  | 815 / 815 |
| `Tuning_fifthGear` | REAL |  | 815 / 815 |
| `Tuning_sixthGear` | REAL |  | 815 / 815 |
| `Tuning_seventhGear` | REAL |  | 815 / 815 |
| `Tuning_eighthGear` | REAL |  | 815 / 815 |
| `Tuning_ninthGear` | REAL |  | 815 / 815 |
| `Tuning_tenthGear` | REAL |  | 815 / 815 |
| `Tuning_frontCamber` | REAL |  | 815 / 815 |
| `Tuning_rearCamber` | REAL |  | 815 / 815 |
| `Tuning_frontToe` | REAL |  | 815 / 815 |
| `Tuning_rearToe` | REAL |  | 815 / 815 |
| `Tuning_frontCaster` | REAL |  | 815 / 815 |
| `Tuning_frontSwaybar` | REAL |  | 815 / 815 |
| `Tuning_rearSwaybar` | REAL |  | 815 / 815 |
| `Tuning_frontSpring` | REAL |  | 815 / 815 |
| `Tuning_rearSpring` | REAL |  | 815 / 815 |
| `Tuning_frontRideHeight` | REAL |  | 815 / 815 |
| `Tuning_rearRideHeight` | REAL |  | 815 / 815 |
| `Tuning_frontDampingStiffness` | REAL |  | 815 / 815 |
| `Tuning_rearDampingStiffness` | REAL |  | 815 / 815 |
| `Tuning_frontBumpRatio` | REAL |  | 815 / 815 |
| `Tuning_rearBumpRatio` | REAL |  | 815 / 815 |
| `Tuning_frontDownforce` | REAL |  | 815 / 815 |
| `Tuning_rearDownforce` | REAL |  | 815 / 815 |
| `Tuning_brakeBalance` | REAL |  | 815 / 815 |
| `Tuning_brakePressure` | REAL |  | 815 / 815 |
| `Tuning_frontAccel` | REAL |  | 815 / 815 |
| `Tuning_rearAccel` | REAL |  | 815 / 815 |
| `Tuning_frontDecel` | REAL |  | 815 / 815 |
| `Tuning_rearDecel` | REAL |  | 815 / 815 |
| `Tuning_centerTorque` | REAL |  | 815 / 815 |
| `RebuildModTorque` | INT |  | 0 / 815 |
| `RebuildModGrip` | INT |  | 0 / 815 |
| `RebuildModBraking` | INT |  | 0 / 815 |
| `RebuildModWeight` | INT |  | 0 / 815 |
| `RebuildScore` | INT |  | 0 / 815 |
| `SharedID` | INT |  | 815 / 815 |
| `IsFavorite` | INT |  | 81 / 815 |
| `HasCurrentOwnerViewedCar` | INT |  | 815 / 815 |
| `Traction_Road` | REAL |  | 815 / 815 |
| `Traction_OffRoad` | REAL |  | 815 / 815 |
| `Traction_Snow` | REAL |  | 815 / 815 |
| `FrontTireAspectRatioOffset` | — |  | 815 / 815 |
| `RearTireAspectRatioOffset` | — |  | 815 / 815 |

### `Career_PurchasedParts`

8,019 rows × 4 columns.

| column | type | key | populated |
| --- | --- | --- | --- |
| `GarageId` | INT |  | 8,019 / 8,019 |
| `UngroupedPartEnum` | INT |  | 8,019 / 8,019 |
| `PartId` | INT |  | 8,019 / 8,019 |
| `PricePaid` | INT |  | 8,019 / 8,019 |

### `FreeCars`

0 rows × 2 columns. Empty in this capture — the schema exists, nothing populates it.

| column | type | key | populated |
| --- | --- | --- | --- |
| `CarId` | INTEGER | pk | — |
| `FreeCount` | INT |  | — |

### `PhotoCaptures`

481 rows × 1 columns.

| column | type | key | populated |
| --- | --- | --- | --- |
| `CarOrdinal` | INTEGER | pk | 481 / 481 |

## 3. Interned string table

1,906 entries of `[u16 len][bytes]`, laid consecutively and sorted: property names, enum names (`vec3`, `wstring`),
GUID strings and world coordinates. Its value to the lab is the rule in the companion doc — the game interns the
**current** car's equipped `Tuning_<ordinal>_<timestamp>` and `Livery_…` here, and nothing else's. A capture with
no current-car context interns none, which is normal and must be handled as such.

## 4. Regenerating this file

```bash
python scripts/telemetry/fh6_profile.py --live --garage    # locate + offline decrypt + parse
```
The decrypt is local (`scripts/tools/fh6_local_decrypt`), so this costs nothing and uploads nothing. Delete the
plaintext afterwards: it carries the account XUID and the whole career.

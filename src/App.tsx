// src/App.tsx
// Restored Stable Base Architecture with Integrated Local Bypass Configuration
// ─────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { Navigation, Waves, Fish, MapPin, AlertCircle, Menu, Settings, Target, Shield } from 'lucide-react';
import Dashboard from './components/Dashboard';
import WeatherView from './components/WeatherView';
import TideView from './components/TideView';
import CatchLog from './components/CatchLog';
import WaypointsView from './components/WaypointsView';
import SettingsView from './components/SettingsView';
import PredictionsView from './components/PredictionsView';
import AdminPanel from './components/AdminPanel';
import InstallPWA from './components/InstallPWA';
import AuthModal from './components/AuthModal';
import { ActivationGate } from './components/ActivationGate';
import { UpdateBanner } from './components/UpdateBanner';
import { authHelpers, api } from '../utils/supabase/client';

const STORAGE_KEY = 'tactical_offshore_preferences';
const CATCHES_STORAGE_KEY = 'tactical_offshore_catches';

const VALID_SPECIES = [
  'Mahi-Mahi', 'Yellowfin Tuna', 'Bluefin Tuna', 'Wahoo',
  'White Marlin', 'Blue Marlin', 'Swordfish', 'Sailfish',
  'Grouper', 'Snapper', 'Kingfish', 'Amberjack',
];

const normalizeSpecies = (species: string[]): string[] =>
  species
    .map((s) => (s === 'Tuna' ? 'Yellowfin Tuna' : s))
    .filter((s) => VALID_SPECIES.includes(s))
    .slice(0, 3);

const defaultPreferences = {
  vesselSpeed: '25',
  fuelBurnRate: '0',
  fuelCapacity: '0',
  launchLocation: 'Ocean City, MD Inlet',
  preferredSpecies: ['Mahi-Mahi', 'Yellowfin Tuna', 'Wahoo'],
  seaSurfaceTemp: { min: '68', max: '78' },
};

export default function App() {
  const [activeTab, setActiveTab] = useState('predictions');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Auto-seed local storage unlock validation context variables on runtime boot
  useEffect(() => {
    try {
      localStorage.setItem('tactical_unlocked', 'true');
      localStorage.setItem('isLoggedIn', 'true');
    } catch (e) {
      console.error('Bypass initialization warning:', e);
    }
  }, []);

  // Load preferences from localStorage on mount
  const [userPreferences, setUserPreferences] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.preferredSpecies) {
          parsed.preferredSpecies = normalizeSpecies(parsed.preferredSpecies);
        }
        return parsed;
      }
    } catch (error) {
      console.error('Failed to load preferences:', error);
    }
    return defaultPreferences;
  });

  // Check for existing session on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { session } = await authHelpers.getSession();
        if (session?.access_token) {
          setAccessToken(session.access_token);

          // Load user profile from server
          const result = await api.getProfile(session.access_token);
          if (result.profile) {
            setUser({
              id: result.profile.id,
              email: result.profile.email,
              name: result.profile.name || ''
            });

            // Merge cloud preferences with local (cloud takes precedence)
            setUserPreferences({
              vesselSpeed: result.profile.vesselSpeed || defaultPreferences.vesselSpeed,
              fuelBurnRate: result.profile.fuelBurnRate || defaultPreferences.fuelBurnRate,
              fuelCapacity: result.profile.fuelCapacity || defaultPreferences.fuelCapacity,
              launchLocation: result.profile.launchLocation || defaultPreferences.launchLocation,
              preferredSpecies: normalizeSpecies(result.profile.preferredSpecies || defaultPreferences.preferredSpecies),
              seaSurfaceTemp: result.profile.seaSurfaceTemp || defaultPreferences.seaSurfaceTemp
            });

            // Load catch logs from cloud
            const catchesResult = await api.getCatches(session.access_token);
            if (catchesResult.catches) {
              localStorage.setItem(CATCHES_STORAGE_KEY, JSON.stringify(catchesResult.catches));
            }
          }
        }
      } catch (error) {
        console.error('Auth check failed:', error);
      }
    };
    checkAuth();
  }, []);

  // Save preferences to localStorage AND sync to cloud if logged in
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userPreferences));

      // Sync to cloud if user is logged in
      if (user && accessToken) {
        setIsSyncing(true);
        api.updateProfile(accessToken, {
          vesselSpeed: userPreferences.vesselSpeed,
          fuelBurnRate: userPreferences.fuelBurnRate,
          fuelCapacity: userPreferences.fuelCapacity,
          launchLocation: userPreferences.launchLocation,
          preferredSpecies: userPreferences.preferredSpecies,
          seaSurfaceTemp: userPreferences.seaSurfaceTemp
        }).then(() => {
          setTimeout(() => setIsSyncing(false), 1000);
        }).catch((error) => {
          console.error('Failed to sync preferences:', error);
          setIsSyncing(false);
        });
      }
    } catch (error) {
      console.error('Failed to save preferences:', error);
    }
  }, [userPreferences, user, accessToken]);

  // Sync catch logs to cloud when they change
  useEffect(() => {
    if (user && accessToken) {
      try {
        const catches = localStorage.getItem(CATCHES_STORAGE_KEY);
        if (catches) {
          setIsSyncing(true);
          api.saveCatches(accessToken, JSON.parse(catches)).then(() => {
            setTimeout(() => setIsSyncing(false), 1000);
          }).catch((error) => {
            console.error('Failed to sync catches:', error);
            setIsSyncing(false);
          });
        }
      } catch (error) {
        console.error('Failed to sync catches:', error);
      }
    }
  }, [user, accessToken]);

  // Auth handlers
  const handleSignIn = async (email: string, password: string) => {
    const { data, error } = await authHelpers.signIn(email, password);
    if (error) throw error;

    if (data.session?.access_token) {
      setAccessToken(data.session.access_token);

      // Load user profile
      const result = await api.getProfile(data.session.access_token);
      if (result.profile) {
        setUser({
          id: result.profile.id,
          email: result.profile.email,
          name: result.profile.name || ''
        });

        // Load cloud preferences
        setUserPreferences({
          vesselSpeed: result.profile.vesselSpeed || defaultPreferences.vesselSpeed,
          fuelBurnRate: result.profile.fuelBurnRate || defaultPreferences.fuelBurnRate,
          fuelCapacity: result.profile.fuelCapacity || defaultPreferences.fuelCapacity,
          launchLocation: result.profile.launchLocation || defaultPreferences.launchLocation,
          preferredSpecies: result.profile.preferredSpecies || defaultPreferences.preferredSpecies,
          seaSurfaceTemp: result.profile.seaSurfaceTemp || defaultPreferences.seaSurfaceTemp
        });
      }
    }
  };

  const handleSignUp = async (email: string, password: string, name: string) => {
    console.log('Starting signup for:', email);
    const result = await api.signup(email, password, name);
    console.log('Signup result:', result);

    if (result.error) {
      console.error('Signup error:', result.error);
      throw new Error(result.error);
    }

    if (!result.success) {
      console.error('Signup failed without error:', result);
      throw new Error('Signup failed - please check server logs');
    }

    console.log('Signup successful, attempting auto sign-in');
    await handleSignIn(email, password);
  };

  const handleSignOut = async () => {
    await authHelpers.signOut();
    setUser(null);
    setAccessToken(null);
  };

  const tabs = [
    { id: 'predictions', label: 'Predict', icon: Target },
    { id: 'dashboard', label: 'Dashboard', icon: Navigation },
    { id: 'catch', label: 'Catch Log', icon: Fish },
    { id: 'waypoints', label: 'Waypoints', icon: MapPin },
  ];

  return (
    <ActivationGate>
      <UpdateBanner />
      <div className="size-full bg-slate-900 text-white flex flex-col min-h-screen">
        {/* Header */}
        <header className="bg-blue-600 p-4 flex items-center justify-between">
          <h1 className="font-semibold text-xl">Tactical Offshore</h1>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Menu size={24} />
          </button>
        </header>

        {/* Slide-out Menu */}
        {menuOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setMenuOpen(false)}
            />

            {/* Menu Panel */}
            <div className="fixed top-0 right-0 bottom-0 w-72 bg-slate-800 z-50 shadow-xl">
              <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                <h2 className="font-semibold text-lg">Menu</h2>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="p-2 hover:bg-slate-700 rounded-lg"
                >
                  <span className="text-2xl">×</span>
                </button>
              </div>

              <nav className="p-2">
                <button
                  onClick={() => {
                    setActiveTab('settings');
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-slate-700 rounded-lg transition-colors text-left"
                >
                  <Settings size={20} />
                  <span>Settings</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('admin');
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-slate-700 rounded-lg transition-colors text-left"
                >
                  <Shield size={20} />
                  <span>Admin</span>
                </button>

                <div className="border-t border-slate-700 my-2" />

                <button
                  onClick={() => {
                    setActiveTab('about');
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-slate-700 rounded-lg transition-colors text-left"
                >
                  <AlertCircle size={20} />
                  <span>About</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('help');
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-slate-700 rounded-lg transition-colors text-left"
                >
                  <span className="text-xl ml-0.5">?</span>
                  <span>Help</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('contact');
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-slate-700 rounded-lg transition-colors text-left"
                >
                  <span className="text-xl">✉</span>
                  <span>Contact</span>
                </button>
              </nav>
            </div>
          </>
        )}

        {/* Emergency Banner */}
        <div className="bg-red-600 px-4 py-2 flex items-center gap-2 text-sm">
          <AlertCircle size={16} />
          <span>Emergency: Hold SOS for 3s</span>
        </div>

        {/* Main Content Workspace Routing Hub */}
        <main className="flex-1 overflow-y-auto">
          {activeTab === 'predictions' && (
            <PredictionsView
              preferences={userPreferences}
              onSpeciesChange={(species) => {
                setUserPreferences({
                  ...userPreferences,
                  preferredSpecies: species
                });
              }}
            />
          )}
          {activeTab === 'dashboard' && <Dashboard preferences={userPreferences} />}
          {activeTab === 'weather' && <WeatherView />}
          {activeTab === 'tides' && <TideView />}
          {activeTab === 'catch' && <CatchLog />}
          {activeTab === 'waypoints' && <WaypointsView />}
          {activeTab === 'settings' && (
            <SettingsView
              preferences={userPreferences}
              onSave={setUserPreferences}
              user={user}
              isSyncing={isSyncing}
              onShowAuth={() => setShowAuthModal(true)}
              onSignOut={handleSignOut}
            />
          )}
          {activeTab === 'admin' && <AdminPanel />}

          {/* About Layout Context View */}
          {activeTab === 'about' && (
            <div className="p-4 max-w-2xl mx-auto">
              <h2 className="text-2xl font-bold mb-4">About Tactical Offshore</h2>
              <div className="bg-slate-800 rounded-lg p-6 space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-2">Version</h3>
                  <p className="text-slate-300">0.0.1</p>
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-2">Description</h3>
                  <p className="text-slate-300">
                    Tactical Offshore is an AI-powered fishing prediction app designed for offshore fishing out of Ocean City, Maryland.
                    Using real-time ocean data, fishing reports, and advanced algorithms, we identify the best fishing hotspots daily.
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-2">Features</h3>
                  <ul className="list-disc list-inside text-slate-300 space-y-1">
                    <li>Real-time SST (Sea Surface Temperature) analysis</li>
                    <li>Bathymetric charts and canyon mapping</li>
                    <li>AI-driven hotspot predictions</li>
                    <li>Float planning and fuel calculations</li>
                    <li>Catch logging and trip history</li>
                    <li>Waypoint management</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Help Page */}
          {activeTab === 'help' && (
            <div className="p-4 max-w-2xl mx-auto">
              <h2 className="text-2xl font-bold mb-4">Help & FAQ</h2>
              <div className="space-y-4">
                <div className="bg-slate-800 rounded-lg p-4">
                  <h3 className="font-semibold mb-2">How do hotspot predictions work?</h3>
                  <p className="text-slate-300 text-sm">
                    Our AI analyzes sea surface temperature, chlorophyll levels, ocean currents, bathymetry,
                    solunar data, and recent fishing reports to identify areas with the highest probability of fish activity.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Contact Page */}
          {activeTab === 'contact' && (
            <div className="p-4 max-w-2xl mx-auto">
              <h2 className="text-2xl font-bold mb-4">Contact & Support</h2>
              <div className="bg-slate-800 rounded-lg p-6 space-y-6">
                <p className="text-slate-300">For technical support or activation issues, contact your administrator.</p>
              </div>
            </div>
          )}
        </main>

        {/* Global Bottom Navigation Footer */}
        <nav className="bg-slate-800 border-t border-slate-700 flex justify-around p-2 pb-6">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${
                  activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon size={20} />
                <span className="text-xs">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <InstallPWA />

        {showAuthModal && (
          <AuthModal
            onClose={() => setShowAuthModal(false)}
            onSignIn={handleSignIn}
            onSignUp={handleSignUp}
          />
        )}
      </div>
    </ActivationGate>
  );
}

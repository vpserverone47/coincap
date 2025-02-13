"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Search, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Cryptocurrency {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  market_cap_rank: number;
  high_24h: number;
  low_24h: number;
  circulating_supply: number;
}

const INITIAL_RETRY_DELAY = 2000;
const MAX_RETRIES = 5;
const API_BASE_URL = "https://api.coingecko.com/api/v3";
const BACKUP_API_URL = "https://api.coingecko.com/api/v3";

export default function Home() {
  const [cryptocurrencies, setCryptocurrencies] = useState<Cryptocurrency[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [watchlist, setWatchlist] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watchlist');
      return new Set(saved ? JSON.parse(saved) : []);
    }
    return new Set();
  });
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const [isUsingBackupAPI, setIsUsingBackupAPI] = useState(false);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const toggleWatchlist = (id: string) => {
    setWatchlist(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      localStorage.setItem('watchlist', JSON.stringify([...newSet]));
      return newSet;
    });
  };

  const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 20000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  };

  const fetchCryptoData = async (retry = 0, useBackup = false): Promise<void> => {
    try {
      const delay = retry > 0 ? INITIAL_RETRY_DELAY * Math.pow(2, retry - 1) : 0;
      if (retry > 0) {
        setError(`Retrying in ${delay/1000} seconds... (Attempt ${retry}/${MAX_RETRIES})`);
        await sleep(delay);
      }

      const baseUrl = useBackup ? BACKUP_API_URL : API_BASE_URL;
      const params = new URLSearchParams({
        vs_currency: "usd",
        order: "market_cap_desc",
        per_page: "100",
        page: "1",
        sparkline: "false",
        locale: "en",
        precision: "2"
      });

      const response = await fetchWithTimeout(
        `${baseUrl}/coins/markets?${params}`,
        {
          headers: {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache'
          },
          mode: 'cors',
          credentials: 'omit'
        },
        20000
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => null);
        let errorMessage = `HTTP error! status: ${response.status}`;
        
        try {
          const errorJson = errorText ? JSON.parse(errorText) : null;
          if (errorJson?.error) {
            errorMessage = errorJson.error;
          }
        } catch {
          // If JSON parsing fails, use the status-based message
        }

        if (response.status === 429) {
          errorMessage = "Rate limit exceeded. Please wait a moment...";
          if (retry < MAX_RETRIES) {
            setRetryCount(retry + 1);
            await sleep(5000);
            return fetchCryptoData(retry + 1, useBackup);
          }
          throw new Error("Rate limit exceeded. Please try again in a few minutes.");
        }

        if (response.status === 403) {
          if (!useBackup) {
            setIsUsingBackupAPI(true);
            return fetchCryptoData(0, true);
          }
          throw new Error("Access denied. Please check your API permissions.");
        }

        if (response.status === 404) {
          throw new Error("The requested data is not available.");
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      if (!Array.isArray(data)) {
        throw new Error("Invalid data format received from API");
      }

      if (data.length === 0) {
        throw new Error("No cryptocurrency data available");
      }

      setCryptocurrencies(data);
      setError(null);
      setLoading(false);
      setRetryCount(0);
      setLastUpdateTime(new Date());
      setIsUsingBackupAPI(useBackup);
    } catch (error) {
      let errorMessage = "Failed to fetch cryptocurrency data";
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = "Request timed out. Retrying...";
          if (!useBackup && retry === 0) {
            return fetchCryptoData(0, true);
          }
        } else {
          errorMessage = error.message;
        }
      }

      console.error("Error fetching crypto data:", errorMessage);
      setError(errorMessage);
      setLoading(false);

      const noRetryErrors = [
        "Invalid data",
        "Rate limit exceeded",
        "Access denied",
        "API permissions"
      ];

      if (retry < MAX_RETRIES && !noRetryErrors.some(e => errorMessage.includes(e))) {
        setRetryCount(retry + 1);
        return fetchCryptoData(retry + 1, useBackup);
      }
    }
  };

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    
    const initFetch = async () => {
      await fetchCryptoData();
      if (!error) {
        intervalId = setInterval(() => {
          fetchCryptoData(0, isUsingBackupAPI);
        }, 60000);
      }
    };

    initFetch();

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [error, isUsingBackupAPI]);

  const filteredCryptos = cryptocurrencies.filter((crypto) =>
    crypto.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    crypto.symbol.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  };

  const formatMarketCap = (num: number) => {
    if (num >= 1e12) {
      return (num / 1e12).toFixed(2) + "T";
    }
    if (num >= 1e9) {
      return (num / 1e9).toFixed(2) + "B";
    }
    if (num >= 1e6) {
      return (num / 1e6).toFixed(2) + "M";
    }
    return num.toString();
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              Today's Cryptocurrency Prices by Market Cap
            </h1>
            {lastUpdateTime && (
              <p className="text-sm text-muted-foreground mt-1">
                Last updated: {lastUpdateTime.toLocaleTimeString()}
                {isUsingBackupAPI && " (using backup API)"}
              </p>
            )}
          </div>
          <div className="w-full md:w-96">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search cryptocurrency"
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error}
            </AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="flex flex-col justify-center items-center h-64 gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            {retryCount > 0 && (
              <p className="text-muted-foreground">
                Retrying... (Attempt {retryCount}/{MAX_RETRIES})
              </p>
            )}
          </div>
        ) : cryptocurrencies.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left"></th>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">24h %</th>
                  <th className="px-4 py-3 text-right">Market Cap</th>
                  <th className="px-4 py-3 text-right">Volume(24h)</th>
                </tr>
              </thead>
              <tbody>
                {filteredCryptos.map((crypto) => (
                  <tr
                    key={crypto.id}
                    className="border-b border-border hover:bg-muted/50 transition-colors"
                  >
                    <td className="px-4 py-4 w-8">
                      <Star
                        className={`star-button ${watchlist.has(crypto.id) ? 'active' : ''}`}
                        size={20}
                        onClick={() => toggleWatchlist(crypto.id)}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <span className="rank-badge">
                        {crypto.market_cap_rank}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={crypto.image}
                          alt={crypto.name}
                          className="w-8 h-8"
                        />
                        <div>
                          <div className="font-semibold">{crypto.name}</div>
                          <div className="text-sm text-muted-foreground uppercase">
                            {crypto.symbol}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right font-medium">
                      {formatNumber(crypto.current_price)}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div
                        className={`flex items-center justify-end gap-1 ${
                          crypto.price_change_percentage_24h >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        }`}
                      >
                        {crypto.price_change_percentage_24h >= 0 ? (
                          <ArrowUp className="w-4 h-4" />
                        ) : (
                          <ArrowDown className="w-4 h-4" />
                        )}
                        {Math.abs(crypto.price_change_percentage_24h).toFixed(2)}%
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right font-medium">
                      ${formatMarketCap(crypto.market_cap)}
                    </td>
                    <td className="px-4 py-4 text-right font-medium">
                      ${formatMarketCap(crypto.total_volume)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-muted-foreground">
            No cryptocurrencies found
          </div>
        )}
      </div>
    </div>
  );
}
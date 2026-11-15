import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { 
  Radio, 
  Globe, 
  Volume2, 
  Activity, 
  Calendar, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Users,
  Clock,
  Shield,
  ExternalLink,
  Upload,
  Image as ImageIcon,
  Sparkles
} from "lucide-react";

interface StationEditDialogProps {
  station: any;
  isOpen: boolean;
  onClose: () => void;
  onGenerateAiDescriptions?: (stationId: string, stationName: string) => void;
}

export default function StationEditDialog({ station, isOpen, onClose, onGenerateAiDescriptions }: StationEditDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);
  
  const [formData, setFormData] = useState({
    name: "",
    url: "",
    homepage: "",
    favicon: "",
    countryCode: "",
    language: "",
    tags: "",
    bitrate: "",
  });

  useEffect(() => {
    if (station) {
      setFormData({
        name: station.name || "",
        url: station.url || "",
        homepage: station.homepage || "",
        favicon: station.favicon || "",
        countryCode: station.countryCode || "",
        language: station.language || "",
        tags: station.tags || "",
        bitrate: station.bitrate?.toString() || "",
      });
    }
  }, [station]);

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const stationId = station._id || station.id;
      const response = await fetch(`/api/stations/${stationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update station');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/stations'] });
      toast({
        title: "Station Updated",
        description: "The station has been updated successfully.",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update station.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(formData);
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleFaviconUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/') && !/\.svg$/i.test(file.name)) {
      toast({
        title: "Invalid File",
        description: "Please select an image file for the favicon.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Favicon must be less than 5MB.",
        variant: "destructive",
      });
      return;
    }

    setIsUploadingFavicon(true);

    try {
      // Upload directly to station-logos folder using new endpoint
      const formDataUpload = new FormData();
      formDataUpload.append('favicon', file);

      const response = await fetch(`/api/admin/stations/${station._id || station.id}/upload-favicon`, {
        method: 'POST',
        body: formDataUpload,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload favicon');
      }

      const result = await response.json();
      setFormData(prev => ({ ...prev, favicon: result.favicon }));
      
      toast({
        title: "Favicon Uploaded",
        description: "Favicon has been uploaded and processed successfully.",
      });
    } catch (error: any) {
      console.error('Favicon upload error:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload favicon.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingFavicon(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (!station) return null;

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    try {
      return format(new Date(dateString), 'MMM dd, yyyy HH:mm');
    } catch {
      return 'Invalid date';
    }
  };

  const getStatusIcon = (isOnline: boolean, hasSSLError: boolean) => {
    if (hasSSLError) return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    return isOnline ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />;
  };

  const getStatusText = (isOnline: boolean, hasSSLError: boolean) => {
    if (hasSSLError) return 'SSL Error';
    return isOnline ? 'Online' : 'Offline';
  };

  const getTrendIcon = (trend: number) => {
    if (trend > 0) return <TrendingUp className="w-4 h-4 text-green-500" />;
    if (trend < 0) return <TrendingDown className="w-4 h-4 text-red-500" />;
    return <Activity className="w-4 h-4 text-gray-500" />;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-white border border-gray-200 shadow-lg text-gray-900">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2 text-gray-900">
            <Radio className="w-5 h-5" />
            <span>Edit Station: {station.name}</span>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="edit" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="edit">Edit Station</TabsTrigger>
            <TabsTrigger value="status">Status & Analytics</TabsTrigger>
            <TabsTrigger value="technical">Technical Details</TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Station Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    placeholder="Station name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="url">Stream URL</Label>
                  <Input
                    id="url"
                    value={formData.url}
                    onChange={(e) => handleInputChange('url', e.target.value)}
                    placeholder="Stream URL"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="homepage">Homepage</Label>
                  <Input
                    id="homepage"
                    value={formData.homepage}
                    onChange={(e) => handleInputChange('homepage', e.target.value)}
                    placeholder="Website URL"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="countryCode">Country Code</Label>
                  <Input
                    id="countryCode"
                    value={formData.countryCode}
                    onChange={(e) => handleInputChange('countryCode', e.target.value)}
                    placeholder="US, UK, DE, etc."
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="favicon">Favicon</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      id="favicon"
                      value={formData.favicon}
                      onChange={(e) => handleInputChange('favicon', e.target.value)}
                      placeholder="Favicon URL (e.g., https://example.com/favicon.ico)"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {formData.favicon && (
                      <div className="flex items-center justify-center w-10 h-10 border rounded bg-white">
                        <img 
                          src={formData.favicon} 
                          alt="Favicon preview" 
                          className="w-6 h-6 object-contain"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.svg,image/svg+xml"
                      onChange={handleFaviconUpload}
                      className="hidden"
                      data-testid="input-favicon-upload"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingFavicon}
                      data-testid="button-upload-favicon"
                    >
                      {isUploadingFavicon ? (
                        <>
                          <Activity className="w-4 h-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2" />
                          Upload
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Enter a favicon URL or upload an image file (max 2MB)
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="language">Language</Label>
                  <Input
                    id="language"
                    value={formData.language}
                    onChange={(e) => handleInputChange('language', e.target.value)}
                    placeholder="English, Spanish, etc."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bitrate">Bitrate (kbps)</Label>
                  <Input
                    id="bitrate"
                    type="number"
                    value={formData.bitrate}
                    onChange={(e) => handleInputChange('bitrate', e.target.value)}
                    placeholder="128"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tags">Tags/Genres</Label>
                <Textarea
                  id="tags"
                  value={formData.tags}
                  onChange={(e) => handleInputChange('tags', e.target.value)}
                  placeholder="Comma separated tags (e.g., rock, music, live)"
                  rows={3}
                />
              </div>

              <div className="flex justify-between items-center">
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={() => {
                    if (onGenerateAiDescriptions && station?.id) {
                      onGenerateAiDescriptions(station.id, station.name);
                      onClose();
                    }
                  }}
                  className="flex items-center gap-2"
                  data-testid="button-generate-ai-descriptions"
                >
                  <Sparkles className="w-4 h-4" />
                  Generate AI Descriptions
                </Button>
                <div className="flex space-x-2">
                  <Button type="button" variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? 'Updating...' : 'Update Station'}
                  </Button>
                </div>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="status" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Status Card */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center space-x-2">
                    {getStatusIcon(station.lastcheckok, station.sslError)}
                    <span>Current Status</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {getStatusText(station.lastcheckok, station.sslError)}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Last checked: {formatDate(station.lastchecktime)}
                  </p>
                </CardContent>
              </Card>

              {/* Popularity Card */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center space-x-2">
                    <Users className="w-4 h-4" />
                    <span>Popularity</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {(station.clickcount || 0).toLocaleString()}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Total plays</p>
                  {station.clicktrend !== undefined && station.clicktrend !== 0 && (
                    <div className="flex items-center space-x-1 mt-2">
                      {getTrendIcon(station.clicktrend)}
                      <span className="text-xs">
                        Trend: {station.clicktrend > 0 ? '+' : ''}{station.clicktrend}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quality Card */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center space-x-2">
                    <Activity className="w-4 h-4" />
                    <span>Quality Rating</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{station.votes || 0}</div>
                  <p className="text-xs text-gray-500 mt-1">Community votes</p>
                </CardContent>
              </Card>
            </div>

            <Separator />

            {/* Detailed Status Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center space-x-2">
                  <Clock className="w-5 h-5" />
                  <span>Monitoring History</span>
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Last Check Time:</span>
                    <Badge variant="outline" className="text-xs">
                      {formatDate(station.lastchecktime)}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Last Successful Check:</span>
                    <Badge variant="outline" className="text-xs">
                      {formatDate(station.lastcheckoktime)}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Last Local Check:</span>
                    <Badge variant="outline" className="text-xs">
                      {formatDate(station.lastlocalchecktime)}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center space-x-2">
                  <Shield className="w-5 h-5" />
                  <span>Security & Reliability</span>
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">SSL Status:</span>
                    <Badge 
                      variant={station.sslError ? "destructive" : "secondary"}
                      className="text-xs"
                    >
                      {station.sslError ? 'SSL Error' : 'SSL OK'}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Stream Status:</span>
                    <Badge 
                      variant={station.lastcheckok ? "secondary" : "destructive"}
                      className="text-xs"
                    >
                      {station.lastcheckok ? 'Accessible' : 'Inaccessible'}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Click Timestamp:</span>
                    <Badge variant="outline" className="text-xs">
                      {formatDate(station.clicktimestamp)}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="technical" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center space-x-2">
                  <Volume2 className="w-5 h-5" />
                  <span>Audio Specifications</span>
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Codec:</span>
                    <Badge variant="secondary">{station.codec || 'Unknown'}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Bitrate:</span>
                    <Badge variant="outline">{station.bitrate || 0} kbps</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Stream URL:</span>
                    <a 
                      href={station.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-xs flex items-center space-x-1"
                    >
                      <span>Open Stream</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Resolved URL:</span>
                    {station.urlResolved && station.urlResolved !== station.url ? (
                      <a 
                        href={station.urlResolved} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs flex items-center space-x-1"
                      >
                        <span>Resolved</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <Badge variant="outline" className="text-xs">Same as stream</Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center space-x-2">
                  <Globe className="w-5 h-5" />
                  <span>Geographic & Metadata</span>
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Country:</span>
                    <Badge variant="secondary">{station.countryCode || 'Unknown'}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Language:</span>
                    <Badge variant="outline">{station.language || 'Unknown'}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Language Codes:</span>
                    <Badge variant="outline" className="text-xs">
                      {station.languageCodes || 'N/A'}
                    </Badge>
                  </div>
                  {station.geoLat && station.geoLong && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Coordinates:</span>
                      <Badge variant="outline" className="text-xs">
                        {parseFloat(station.geoLat).toFixed(2)}, {parseFloat(station.geoLong).toFixed(2)}
                      </Badge>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Station UUID:</span>
                    <Badge variant="outline" className="text-xs font-mono">
                      {station.stationUuid || 'N/A'}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <h3 className="text-lg font-semibold">Tags & Genres</h3>
              <div className="flex flex-wrap gap-2">
                {station.tags ? station.tags.split(',').filter((tag: string) => tag.trim()).map((tag: string, index: number) => (
                  <Badge key={index} variant="outline" className="text-xs">
                    {tag.trim()}
                  </Badge>
                )) : (
                  <span className="text-sm text-gray-500">No tags available</span>
                )}
              </div>
            </div>

            {station.homepage && (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Website</h3>
                <a 
                  href={station.homepage} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline flex items-center space-x-2"
                >
                  <Globe className="w-4 h-4" />
                  <span>{station.homepage}</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
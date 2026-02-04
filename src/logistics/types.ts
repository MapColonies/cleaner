import type { IJobnikSDK } from '@map-colonies/jobnik-sdk';

export interface LogisticJobTypes {
  hazmatTransport: {
    data: { unNumber: string; hazardClass: string };
    userMetadata: { leaksCount: number; casualtyCount: number };
  };
  standardTransport: {
    data: {
      condition: 'clear' | 'rain' | 'snow';
      visibility: number; // in meters
      temperature: number; // in celsius
      windSpeed: number; // in km/h
    };
    userMetadata: { fugitivesCount: number };
  };
}

export interface LogisticStageTypes {
  pickup: {
    data: {
      location: string;
      timeWindowStart: string; // ISO 8601 date string
      timeWindowEnd: string; // ISO 8601 date string
    };
    userMetadata: { notes?: string };
    task: { data: { itemId: string; quantity: number }; userMetadata: { pickedBy: string } };
  };
  drive: {
    data: {
      routeId: string;
      estimatedDuration: number; // in minutes
    };
    userMetadata: { driverId: string; vehicleId: string };
    task: { data: { distance: number }; userMetadata: { startedAt: string; endedAt?: string } };
  };
  delivery: {
    data: {
      location: string;
      timeWindowStart: string; // ISO 8601 date string
      timeWindowEnd: string; // ISO 8601 date string
    };
    userMetadata: { signaturedBy: string };
    task: { data: { itemId: string; quantity: number }; userMetadata: { deliveredBy: string } };
  };
}

export type LogisticsSDK = IJobnikSDK<LogisticJobTypes, LogisticStageTypes>;
